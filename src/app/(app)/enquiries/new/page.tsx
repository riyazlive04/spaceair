import { requireUser } from "@/lib/auth";
import { createEnquiry } from "@/lib/actions";
import { PageHeader, Card } from "@/components/ui";
import { EnquiryFields } from "@/components/enquiry-form";

export const metadata = { title: "New enquiry" };

export default async function NewEnquiry() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="New enquiry" sub="Log a phone call, walk-in or email. On save the CRM assigns an engineer, creates the first-response task and acknowledges the client on WhatsApp." />
      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4 max-lg:grid-cols-1">
        <Card>
          <form action={createEnquiry}>
            <EnquiryFields branch={user.branch} />
          </form>
        </Card>
        <Card title="What happens automatically">
          <ol className="flex list-decimal flex-col gap-2 pl-4 text-[13px] text-ink-2">
            <li>Existing clients are recognised and routed to their account owner.</li>
            <li>New clients go to the least-loaded sales engineer in the branch.</li>
            <li>The client gets a WhatsApp with the reference number and engineer's contact.</li>
            <li>No response in 4 h: the branch head is alerted. In 24 h: re-assigned.</li>
          </ol>
        </Card>
      </div>
    </>
  );
}
