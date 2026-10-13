import type { Metadata } from "next";
import LegalPage, { LegalSection } from "@/components/LegalPage";
import { config } from "@/server/runtime";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: `Terms | ${config().siteName}` };
}

// House rules for members of this site. A sensible default for a group of
// friends; the host can edit this page to say whatever their group agrees to.
export default function TermsPage() {
  const { siteName } = config();
  return (
    <LegalPage
      title="Terms"
      intro={`${siteName} is a private space shared by people who know each other. Using it means agreeing to a few simple rules.`}
    >
      <LegalSection title="Your account">
        <p>
          Accounts are by invitation. Keep your password to yourself, and tell the host
          if you think someone else has got into your account. You are responsible for
          what is done with it.
        </p>
      </LegalSection>

      <LegalSection title="What you share">
        <p>
          Your photos and words stay yours. By posting them you let the site store them
          and show them to the other members, which is the whole point. Only post
          things you have the right to share, and think about the people in your
          photos before you post them.
        </p>
        <p>
          Don&apos;t post anything illegal, don&apos;t harass or impersonate anyone,
          don&apos;t share other members&apos; photos or messages outside the group
          without asking, and don&apos;t try to break into the site or other
          people&apos;s accounts.
        </p>
      </LegalSection>

      <LegalSection title="The host's role">
        <p>
          The host runs this site voluntarily and may remove posts, mute members, or
          close accounts to keep the space working for everyone. The site may be
          unavailable at times, and it may be shut down. If your photos matter to you,
          keep your own copies — Settings can export your data.
        </p>
      </LegalSection>

      <LegalSection title="No guarantees">
        <p>
          The site is provided as it is, without warranties of any kind. It runs on
          NoPostNow, open-source software released under the MIT License, whose authors
          do not operate this site and are not responsible for it or its content.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
