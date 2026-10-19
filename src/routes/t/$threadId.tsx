import { createFileRoute } from "@tanstack/react-router";
import { MailHome } from "@/components/mail/home";
import { safeDeepLinkId } from "@/lib/mail/deep-link";

export const Route = createFileRoute("/t/$threadId")({ component: ThreadDeepLink });

function ThreadDeepLink() {
  const { threadId } = Route.useParams();
  return <MailHome threadId={safeDeepLinkId(threadId)} />;
}
