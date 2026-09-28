import { publicEnquiry } from "@/lib/actions";
import { EnquiryFields } from "@/components/enquiry-form";
import { Logo } from "@/components/logo";

export const metadata = { title: "Contact SPACEAIR" };

export default async function Enquire(props: PageProps<"/enquire">) {
  const ref = (await props.searchParams).ref;
  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 px-4 py-12">
      <div>
        <Logo height={52} product={false} />
        <h1 className="h-display mt-2 text-[30px] leading-tight">Tell us about your project</h1>
        <p className="text-ink-2">HVAC, fire fighting, electrical, plumbing, retrofit and AMC across South India and Sri Lanka. An engineer from your nearest office will call you back.</p>
        <p className="mt-1 text-xs text-muted">Sample website form: this page can be embedded on spaceair.in/contactus. Submissions flow straight into the CRM.</p>
      </div>
      {ref ? (
        <div className="card border-good">
          <h2 className="h-display text-[20px]">Thank you, your enquiry {String(ref)} is registered.</h2>
          <p className="text-ink-2">You will receive a WhatsApp confirmation with the name and number of the engineer handling it.</p>
          <a className="link mt-2 text-[13px]" href="/enquire">Submit another enquiry</a>
        </div>
      ) : (
        <form action={publicEnquiry} className="card">
          <EnquiryFields publicForm />
        </form>
      )}
    </main>
  );
}
