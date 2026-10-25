// L3 — GEB
// Input: 文本控件的模型值与当前焦点。
// Output: 聚焦时保留正在输入的草稿，失焦后同步模型值。
// Pos: [Map](L2-2.md)；文本值绑定。
// Effects/Dependencies: 读取 DOM 焦点；SSR 输出模型值，不注册事件。
import { noChange } from "lit";
import { Directive, directive, PartType, type Part } from "lit/directive.js";
import { live } from "lit/directives/live.js";

export const focusedValue = directive(class extends Directive {
  render(value: string) { return value; }
  update(part: Part, [value]: [string]) {
    return part.type === PartType.PROPERTY && part.element.matches(":focus-within") ? noChange : live(value);
  }
});
