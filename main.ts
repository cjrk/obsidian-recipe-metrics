import { newNutritionLivePreview } from 'NutritionLivePreview';
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

class Recipe {
	amountInGram?: number;
	conversionsToGram: Map<string, number>;
	openConversions: Map<string, number>;
	ingredients?: Map<string, { amount: number, unit: string }>;
	nutrients?: Map<string, number>;
}

function getOr<K, V>(m: Map<K, V>, key: K, defaultValue: V): V {
	if (m.has(key)) {
		return m.get(key) as V;
	} else {
		return defaultValue;
	}
}

function unify(s: string, aliasMap: Map<string, string>): string {
	let base = aliasMap.get(s);
	if (base !== undefined) {
		return base;
	} else {
		return s;
	}
}

function numberConv(sparam: string): number {
	let s = sparam.trim();
	if (s === '1/8') return 0.125
	else if (s === '1/4') return 0.25
	else if (s === '1/2') return 0.5
	else return Number(s.replace(',', '.'));
}

function convertToGram(amount: number, unit: string, conversionTable: Map<string, number>): number {
	if (unit === 'g') {
		return amount;
	} else if (conversionTable.has(unit)) {
		let gramPerUnit = conversionTable.get(unit);
		return (gramPerUnit as number) * amount;
	} else {
		console.error('unknown unit: ' + unit);
		console.error(conversionTable);
		return NaN;
	}
}

function nutrientsForGrams(nutrients: Map<string, number>, baseGram: number, targetGram: number): Map<string, number> {
	let kcal = getOr(nutrients, 'kcal', 0);
	let kh = getOr(nutrients, 'kh', 0);
	let fat = getOr(nutrients, 'fat', 0);
	let prot = getOr(nutrients, 'prot', 0);
	return new Map<string, number>([
		['kcal', (kcal * targetGram) / baseGram],
		['fat', (fat * targetGram) / baseGram],
		['kh', (kh * targetGram) / baseGram],
		['prot', (prot * targetGram) / baseGram]
	]);
}

function emptyNutrients(): Map<string, number> {
	return new Map<string, number>([
		['kcal', 0],
		['fat', 0],
		['kh', 0],
		['prot', 0]
	]);
}

function NaNNutrients(): Map<string, number> {
	return new Map<string, number>([
		['kcal', NaN],
		['fat', NaN],
		['kh', NaN],
		['prot', NaN]
	]);
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	recipes: Map<string, Recipe>;
	unitAliases: Map<string, string>;

	unifyUnit(unit: string): string {
		return unify(unit.trim(), this.unitAliases);
	}

	async readRecipeFromFile(file: TFile) {
		let amountRE = /- Ergibt (?<amount>\d[\d,./]*) (?<unit>[\w öäüß]+)/gi;
		let conversionRE = /-\s*(?<unit>[\w öäüß]+): (?<amount>\d[\d,.]*)\s*g/gi;
		let ingredientRE = /-\s+(?<ingredient>[\w öäüß,]+) - (?<amount>\d[\d,./]*)\s*(?<unit>[\w öäüß]+)/gi;
		// extract stuff
		let md = await this.app.vault.cachedRead(file);
		let name = file.basename;
		let recipe = new Recipe();
		// extract conversions
		recipe.conversionsToGram = new Map<string, number>();
		recipe.openConversions = new Map<string, number>();
		let conversionMatches = [...md.matchAll(conversionRE)];
		conversionMatches.forEach(cm => {
			if (cm.groups !== undefined) {
				recipe.conversionsToGram.set(this.unifyUnit(cm.groups['unit'].trim()), numberConv(cm.groups['amount'].trim()));
			}
		});
		// extract amount
		let amountMatch = [...md.matchAll(amountRE)].first();
		if (amountMatch?.groups !== undefined) {
			let amount = amountMatch.groups['amount'];
			let unit = this.unifyUnit(amountMatch.groups['unit'].trim());
			if (unit === 'g') {
				recipe.amountInGram = numberConv(amount);
			} else if (recipe.conversionsToGram.has(unit)) {
				let gramPerUnit = recipe.conversionsToGram.get(unit);
				recipe.amountInGram = numberConv(amount) * (gramPerUnit as number);
			} else {
				// console.error(`Can't parse amount for ${name}`);
				// instead add open conversion
				recipe.openConversions.set(unit, numberConv(amount));
			}
		}
		// extract ingredients
		recipe.ingredients = new Map<string, { amount: number, unit: string }>();
		let ingredientMatches = [...md.matchAll(ingredientRE)];
		ingredientMatches.forEach(m => {
			if (m.groups !== undefined) {
				(recipe.ingredients as Map<string, { amount: number, unit: string }>).set(m.groups['ingredient'].trim(), { amount: numberConv(m.groups['amount']), unit: this.unifyUnit(m.groups['unit'].trim()) });
			}
		});
		// put in db
		if (recipe.ingredients.size > 0) {
			// console.log('adding' + name);
			// console.log(recipe);
			this.recipes.set(name, recipe);
		}
	}

	async readRecipeFromTable(file: TFile) {
		const recipeRE = /\|\s*(?<name>[\w öäüß,]+)\s*\|\s*(?<kcal>\d[\d,.]*)\s*\|\s*(?<fat>\d[\d,.]*)\s*\|\s*(?<kh>\d[\d,.]*)\s*\|\s*(?<prot>\d[\d,.]*)\s*\|\s*(?<units>.*?)\s*\|/gi;
		const unitRE = /(?<unit>[\w öäüß]+?):\s?(?<gram>\d[\d,.]*)/gi;
		let md = await this.app.vault.cachedRead(file);
		
		// extract recipes
		let recipeMatches = [...md.matchAll(recipeRE)];
		recipeMatches.forEach(m => {
			if (m.groups !== undefined) {
				let name = m.groups['name'].trim();
				let recipe = new Recipe();
				recipe.amountInGram = 100;
				recipe.nutrients = new Map<string, number>();
				recipe.nutrients.set('kcal', numberConv(m.groups['kcal']));
				recipe.nutrients.set('fat', numberConv(m.groups['fat']));
				recipe.nutrients.set('kh', numberConv(m.groups['kh']));
				recipe.nutrients.set('prot', numberConv(m.groups['prot']));
				let units = m.groups['units'].trim();
				let unitMatches = [...units.matchAll(unitRE)];
				recipe.conversionsToGram = new Map<string, number>();
				recipe.openConversions = new Map<string, number>();
				unitMatches.forEach(m => {
					if (m.groups !== undefined) {
						recipe.conversionsToGram.set(this.unifyUnit(m.groups['unit'].trim()), numberConv(m.groups['gram']));
					}
				});
				if (recipe.nutrients.size > 0) {
					this.recipes.set(name, recipe);
				}
			}
		});
	}

	parseIngredient(text:string) : { name:string, amount:number, unit:string } | undefined {
		let ingredientRE = /(?<ingredient>[\w öäüß,]+) - (?<amount>\d[\d,./]*)\s*(?<unit>[\w öäüß]+)/i;
		let m = text.match(ingredientRE);
		if (m?.groups) {
			return {
				name: m.groups['ingredient'].trim(),
				amount: numberConv(m.groups['amount']),
				unit: this.unifyUnit(m.groups['unit'].trim())
			}
		}
	}

	calculateNutrients(name: string, amount: number, unit: string): Map<string, number> {
		// load recipe
		let recipe = this.recipes.get(name);
		if (recipe === undefined) {
			// console.error(`Can't find ${name} in recipes`)
			// console.error(this.recipes)
			return NaNNutrients();
		}
		// if recipe has no nutrients but ingredients
		// - calculate nutrients from ingredients
		if (recipe.nutrients === undefined && recipe.ingredients !== undefined) {
			let kcal = 0;
			let fat = 0;
			let kh = 0;
			let prot = 0;
			let calculatedWeight = 0;
			recipe.ingredients.forEach(({ amount, unit }, name) => {
				if (this.recipes.get(name)) {
					let nutrients = this.calculateNutrients(name, amount, unit);
					kcal += getOr(nutrients, 'kcal', 0);
					fat += getOr(nutrients, 'fat', 0);
					kh += getOr(nutrients, 'kh', 0);
					prot += getOr(nutrients, 'prot', 0);
					calculatedWeight += convertToGram(amount, unit, this.recipes.get(name)?.conversionsToGram as Map<string, number>);
				}
			});
			let calculatedNutrients = new Map<string, number>();
			calculatedNutrients.set('kcal', kcal);
			calculatedNutrients.set('fat', fat);
			calculatedNutrients.set('kh', kh);
			calculatedNutrients.set('prot', prot);
			recipe.nutrients = calculatedNutrients;
			if (recipe.amountInGram === undefined) {
				recipe.amountInGram = calculatedWeight;
			}
			recipe.openConversions.forEach((amount, unit) => {
				if (!recipe?.conversionsToGram.has(unit)) {
					recipe?.conversionsToGram.set(unit, (recipe.amountInGram as number) / amount)
				}
			});
			if (!recipe?.conversionsToGram.has('Portion')) {
				recipe?.conversionsToGram.set('Portion', (recipe.amountInGram as number))
			}
		}
		// convert nutritions for amount
		let amountInGram = convertToGram(amount, unit, recipe.conversionsToGram);
		let convertedNutrients = nutrientsForGrams(recipe.nutrients as Map<string, number>, recipe.amountInGram as number, amountInGram);
		return convertedNutrients;
	}

	async updateRecipes() {
		this.recipes = new Map<string, Recipe>();
		await this.readRecipeFromTable(this.app.vault.getAbstractFileByPath('Rezepte/Ingredients.md') as TFile)
			.then(() => {
				return this.app.vault.getMarkdownFiles();
			})
			.then(files => {
				return Promise.all(files.map(it => this.readRecipeFromFile(it)));
			});
	}

	async onload() {
		console.log('loading recipe-metrics')
		await this.loadSettings();
		this.recipes = new Map<string, Recipe>();
		this.unitAliases = new Map<string, string>([
			['Portionen', 'Portion'],
			['Zehen', 'Zehe'],
			['Dosen', 'Dose'],
			['Tassen', 'Tasse'],
		]);

		
		this.app.workspace.onLayoutReady(() => {
			this.updateRecipes();
		});

		this.registerEvent(this.app.vault.on('modify', (f) => {
			this.updateRecipes();
		}));

		this.registerEvent(this.app.vault.on('delete', (f) => {
			this.updateRecipes();
		}));

		this.registerEvent(this.app.vault.on('rename', (f) => {
			this.updateRecipes();
		}));

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			// this.readRecipeFromTable(this.app.vault.getAbstractFileByPath('Rezepte/Ingredients.md') as TFile)
			// 	.then(() => {
			// 		return this.app.vault.getMarkdownFiles();
			// 	})
			// 	.then(files => {
			// 		return Promise.all(files.map(it => this.readRecipeFromFile(it)));
			// 	})
			this.updateRecipes()
				.then(() => {
					let currentFile = this.app.workspace.getActiveFile()?.basename;
					if (currentFile) {
						console.log(currentFile);
						console.log(this.calculateNutrients(currentFile, 1, 'Portion'));
					}
				})
				.then(() => {
					console.log(this.recipes);
				})
				.then(() => {
					new Notice('Hello Plugin');
				})
		});

		this.registerEditorExtension(newNutritionLivePreview(this));

		// console.log("BLAHHHHHHHH")
		// this.registerMarkdownPostProcessor((element, context) => {
		// 	console.log('HEFTIG!')
		// 	let listElements = element.querySelectorAll('code');
		// 	listElements.forEach(elem => {
		// 		context.addChild(new NutritionPill(elem, 'lol'));
		// 	})
		// })

		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		// this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		// 	console.log('click', evt);
		// });

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		// this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
