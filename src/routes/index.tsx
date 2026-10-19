import { createFileRoute } from "@tanstack/react-router";
import { MailHome } from "@/components/mail/home";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <MailHome />;
}
