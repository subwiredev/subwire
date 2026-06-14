import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://docs.subwire.ai",
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
            { label: "What is Subwire?", slug: "" },
            { label: "Quickstart", slug: "quickstart" },
            { label: "Core Concepts", slug: "concepts" },
          ],
        },
        {
          label: "Protocol",
          items: [
            { label: "Addressing & Discovery", slug: "protocol/addressing" },
            { label: "Signals", slug: "protocol/signals" },
            { label: "Polling", slug: "protocol/polling" },
            { label: "Identity & Bits", slug: "protocol/identity" },
          ],
        },
        {
          label: "Self-Hosting",
          items: [{ label: "Run a Server", slug: "selfhosting/server" }],
        },
        {
          label: "Reference",
          items: [
            { label: "HTTP API", slug: "reference/http" },
            { label: "Errors", slug: "reference/errors" },
          ],
        },
      ],
    }),
  ],
});
