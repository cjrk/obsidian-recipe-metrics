import { EditorView, WidgetType } from "@codemirror/view";

export class NutritionPill extends WidgetType {

    title: string;
    popup: string;

    constructor(title:string, popup:string) {
        super()
        this.title = title;
        this.popup = popup;
    }

  toDOM(view: EditorView): HTMLElement {
    const div = document.createElement("span");

    div.innerText = this.title;
    div.style.marginLeft = '1rem';
    div.style.background = 'teal';
    div.style.borderRadius = '10px';
    div.style.padding = '1px 7px';
    div.style.fontSize = 'small';

    return div;
  }

}