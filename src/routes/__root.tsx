import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "Grokbot Mail";

const THEME_BOOT = `try{var s=JSON.parse(localStorage.getItem("grokbot-mail-v1")||"null");var t=s&&s.state&&s.state.settings&&s.state.settings.theme;var dark=t==="lights-out"||t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var dim=t==="dim";var root=document.documentElement;root.classList.toggle("dark",!!dark);root.classList.toggle("dim",!!dim&&!dark);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",dark?"#000000":dim?"#15202b":"#ffffff");var g=s&&s.state&&s.state.settings&&s.state.settings.glass;if(typeof g==="number"){root.style.setProperty("--glass-alpha",String(34+g*0.5));root.style.setProperty("--glass-blur",String(8+g*0.22));}}catch(e){}`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      {
        name: "description",
        content: "Grokbot Mail",
      },
      { name: "theme-color", content: "#ffffff" },
      { name: "apple-mobile-web-app-title", content: "Mail" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
