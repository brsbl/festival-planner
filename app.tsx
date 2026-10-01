import { definePluginApp } from "@get-bb/plugin-sdk/app";
import festivals from "./festivals/index.json";

const BASE = "/api/v1/plugins/festival-planner/http";

export default definePluginApp((app) => {
  for (const festival of festivals) {
    const Page = () => (
      <iframe
        src={`${BASE}/${festival.slug}/index.html`}
        title={festival.title}
        allow="autoplay"
        className="block h-full min-h-0 w-full flex-1 border-0"
      />
    );
    app.slots.navPanel({
      id: festival.slug,
      title: festival.title,
      icon: `festival-planner/${festival.icon}`,
      path: festival.slug,
      component: Page,
    });
  }
});
