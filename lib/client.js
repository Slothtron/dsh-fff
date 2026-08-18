window.__ModuleLoader__.load({ id: "@slothtron/dsh-fff", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_client = require("@deepseek-ai/dsh-client-runtime/client");

// src/client/WatchCard.module.css
(function() {
  if (typeof document !== "undefined") {
    const existing = document.querySelector('style[data-plugin="@slothtron/dsh-fff"][data-file="WatchCard.module.css"]');
    if (!existing) {
      const style = document.createElement("style");
      style.setAttribute("data-plugin", "@slothtron/dsh-fff");
      style.setAttribute("data-file", "WatchCard.module.css");
      style.textContent = ".card {\n  list-style: none;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  padding: 12px;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n\n.head {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n.title {\n  color: var(--dsw-alias-label-primary);\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 1.5;\n}\n\n.description {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 1.5;\n}\n\n.body {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n.row {\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  cursor: pointer;\n}\n\n.rowText {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n\n.label {\n  color: var(--dsw-alias-label-primary);\n  font-size: 13px;\n  line-height: 1.5;\n}\n\n.hint {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 1.5;\n}\n\n.failed {\n  color: var(--dsw-alias-label-error);\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.5;\n}\n";
      document.head.appendChild(style);
    }
  }
})();
var WatchCard_default = { "card": "card", "head": "head", "title": "title", "description": "description", "body": "body", "row": "row", "rowText": "rowText", "label": "label", "hint": "hint", "failed": "failed" };

// src/client/WatchCard.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function WatchCard(props) {
  const state = props.useFffCard((snapshot) => snapshot);
  if (!state.available) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { className: WatchCard_default.card, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: WatchCard_default.head, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: WatchCard_default.title, children: "fff \u6587\u4EF6\u641C\u7D22" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: WatchCard_default.description, children: "\u63A7\u5236\u5E38\u9A7B fff \u7D22\u5F15\u662F\u5426\u5B9E\u65F6\u76D1\u542C\u5DE5\u4F5C\u533A\u6587\u4EF6\u53D8\u52A8" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: WatchCard_default.body, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: WatchCard_default.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: state.enabled,
            disabled: !state.writable || state.saving,
            onChange: () => {
              props.toggle();
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: WatchCard_default.rowText, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: WatchCard_default.label, children: "\u542F\u7528\u6587\u4EF6\u76D1\u542C\uFF08watch\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: WatchCard_default.hint, children: "\u5F00\u542F\u540E\u5DE5\u4F5C\u533A\u5185\u6587\u4EF6\u589E\u5220\u6539\u4F1A\u5B9E\u65F6\u53CD\u6620\u5230\u641C\u7D22\u7ED3\u679C\uFF1B\u5173\u95ED\u5219\u4E3A\u5FEB\u7167\u8BED\u4E49\uFF08\u5207\u6362\u5DE5\u4F5C\u533A\u65F6\u91CD\u5EFA\u7D22\u5F15\uFF09\u3002" })
        ] })
      ] }),
      state.failed ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: WatchCard_default.failed, role: "status", children: "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5" }) : null
    ] })
  ] });
}

// src/client/index.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var NS = "dsh-fff";
var FffCardController = class {
  constructor(scope) {
    this.scope = scope;
    this.store = (0, import_client.createSnapshotStore)(this.projection());
    scope.subscribe(() => {
      this.publish();
    });
  }
  scope;
  store;
  saving = false;
  failed = false;
  snapshot() {
    return this.scope.getSnapshot();
  }
  projection() {
    const s = this.snapshot();
    return {
      available: s.status === "ready",
      writable: s.writable,
      enabled: s.value?.enableWatch === true,
      saving: this.saving,
      failed: this.failed
    };
  }
  publish() {
    this.store.set(this.projection());
  }
  /** Flip the watch switch and persist through the settings scope. */
  async toggle() {
    if (this.saving) return;
    const current = this.projection().enabled;
    this.saving = true;
    this.failed = false;
    this.publish();
    try {
      await this.scope.set("enableWatch", !current);
      this.failed = this.projection().enabled === current;
    } catch {
      this.failed = true;
    }
    this.saving = false;
    this.publish();
  }
  inject() {
    return {
      hooks: { fffCard: this.store },
      toggle: () => {
        void this.toggle();
      }
    };
  }
};
var inject = ["slots", "settingsScope"];
function apply(ctx) {
  const scope = ctx.settingsScope.bind({ namespace: NS });
  const controller = new FffCardController(scope);
  const face = controller.inject();
  ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
    name: "settings.plugin.item",
    key: NS,
    inject: () => face
  }, ((props) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(WatchCard, { ...props }))));
}
return module.exports; } });
