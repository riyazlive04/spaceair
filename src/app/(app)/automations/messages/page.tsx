import { desc } from "drizzle-orm";
import { db, schema as S } from "@/db";
import { requireUser } from "@/lib/auth";
import { ago } from "@/lib/format";
import { PageHeader, Pill, Tabs, TableWrap } from "@/components/ui";

export const metadata = { title: "Messages sent" };

export default async function Messages() {
  await requireUser();
  const now = new Date();
  const [msgs, rules] = await Promise.all([db.select().from(S.outbox).orderBy(desc(S.outbox.createdAt)), db.select().from(S.automationRules)]);
  return (
    <>
      <PageHeader title="Automations" sub="Every WhatsApp and email the CRM sent on the team's behalf. In production these go out through the WhatsApp Business Cloud API and a transactional email service; here they are recorded in the outbox." />
      <Tabs current="Messages sent" items={[{ href: "/automations", label: "Rules", count: rules.length }, { href: "/automations/messages", label: "Messages sent", count: msgs.length }]} />
      <TableWrap>
        <table className="tbl">
          <thead><tr><th>When</th><th>Channel</th><th>To</th><th>Message</th><th>About</th></tr></thead>
          <tbody>
            {msgs.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap font-mono text-[11.5px] text-muted">{ago(m.createdAt, now)}</td>
                <td><Pill tone={m.channel === "whatsapp" ? "good" : "info"}>{m.channel === "whatsapp" ? "WhatsApp" : "Email"}</Pill></td>
                <td className="whitespace-nowrap font-mono text-[12px]">{m.to}</td>
                <td className="max-w-[560px]">{m.subject && <div className="font-medium">{m.subject}</div>}<div className="whitespace-pre-line text-[12.5px] text-ink-2">{m.body}</div></td>
                <td className="whitespace-nowrap text-xs text-muted">{m.relatedType}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
