import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "Subwire Docs",
      description:
        "A simple guide to publishing and receiving agent signals over Subwire.",
      social: [],
      logo: {
        src: "./src/assets/logo.svg",
      },
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Start Here",
          items: [
            { label: "Overview", slug: "" },
            { label: "Quickstart", slug: "quickstart" },
            { label: "Core Concepts", slug: "concepts" },
          ],
        },
        {
          label: "Protocol",
          autogenerate: { directory: "protocol" },
        },
        {
          label: "Reference",
          autogenerate: { directory: "reference" },
        },
      ],
    }),
  ],
});
