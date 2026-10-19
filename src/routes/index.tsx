import { createFileRoute } from "@tanstack/react-router";
import { MailHome } from "@/components/mail/home";
import { fetchDemoPreview, type DemoPreview } from "@/lib/mail/mail-rpc";

const EMPTY_PREVIEW: DemoPreview = { sample: false, note: "", subjects: [] };

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      return await fetchDemoPreview();
    } catch {
      return EMPTY_PREVIEW;
    }
  },
  component: Home,
});

function Home() {
  const preview = Route.useLoaderData();
  return <MailHome preview={preview} />;
}
