import { ViewUpdate, PluginValue, EditorView, ViewPlugin, PluginSpec, DecorationSet, Decoration } from "@codemirror/view";
import { RangeSetBuilder } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { NutritionPill } from "NutritionPill";
import MyPlugin from "main";

class NutritionLivePreview implements PluginValue {


    decorations: DecorationSet;
    basePlugin: MyPlugin;

    constructor(view: EditorView, basePlugin: MyPlugin) {
        this.basePlugin = basePlugin;
        this.decorations = this.buildDecorations(view, basePlugin);
    }

    update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view, this.basePlugin);
        }
    }

    destroy() {
    }

    buildDecorations(view: EditorView, basePlugin: MyPlugin): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();

        for (let { from, to } of view.visibleRanges) {
            syntaxTree(view.state).iterate({
                from,
                to,
                enter(node) {
                    console.log(node.type.name)
                    console.log(view.state.sliceDoc(node.from, node.to))
                    if (node.type.name.startsWith("list")) {
                        let text = view.state.sliceDoc(node.from, node.to);
                        let ingredient = basePlugin.parseIngredient(text);
                        if (ingredient) {
                            let nutrients = basePlugin.calculateNutrients(ingredient.name, ingredient.amount, ingredient.unit);
                            if (nutrients.get('kcal')) {
                                builder.add(
                                    node.to,
                                    node.to,
                                    Decoration.widget({
                                        widget: new NutritionPill(''+Math.round(nutrients.get('kcal') as number)+' kCal', text),
                                        side: 1
                                    })
                                );
                            }
                        }
                    }
                },
            });
        }

        return builder.finish();
    }

}

const pluginSpec: PluginSpec<NutritionLivePreview> = {
    decorations: (value: NutritionLivePreview) => value.decorations,
};

// export const newNutritionLivePreview = () => ViewPlugin.fromClass(NutritionLivePreview, pluginSpec);

export const newNutritionLivePreview = (plugin: MyPlugin) => {
    return ViewPlugin.define((view) => new NutritionLivePreview(view, plugin), pluginSpec);
};

// export const examplePlugin = ViewPlugin.fromClass(NutritionLivePreview);