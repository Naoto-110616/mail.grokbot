import { createFileRoute } from "@tanstack/react-router";
import { MailHome } from "@/components/mail/home";
import { safeDeepLinkId } from "@/lib/mail/deep-link";

export const Route = createFileRoute("/o/$clientSendId")({ component: OutboxDeepLink });

function OutboxDeepLink() {
  const { clientSendId } = Route.useParams();
  return <MailHome outboxId={safeDeepLinkId(clientSendId)} />;
}
