import { createFileRoute } from "@tanstack/react-router";
import { MailHome } from "@/components/mail/home";
import { safeDeepLinkId } from "@/lib/mail/deep-link";

export const Route = createFileRoute("/m/$messageId")({ component: MessageDeepLink });

function MessageDeepLink() {
  const { messageId } = Route.useParams();
  return <MailHome messageId={safeDeepLinkId(messageId)} />;
}
