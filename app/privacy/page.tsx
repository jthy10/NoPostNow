import type { Metadata } from "next";
import LegalPage, { LegalSection } from "@/components/LegalPage";
import { config } from "@/server/runtime";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: `Privacy | ${config().siteName}` };
}

// A plain description of what the software stores and who can see it. It is
// accurate for an unmodified install; a host who changes how the site works,
// or who has legal obligations of their own, should edit this page.
export default function PrivacyPage() {
  const { siteName } = config();
  return (
    <LegalPage
      title="Privacy"
      intro={`${siteName} is a private photo feed run by the person who invited you, on a computer they control. It runs on NoPostNow, open-source software. This page explains what is stored and who can see it.`}
    >
      <LegalSection title="Who runs this site">
        <p>
          This site is operated by its host — the person or group who set it up and
          invited you — not by the authors of the NoPostNow software. Everything you
          share is stored on the host&apos;s own machine. Questions about your data go
          to them; inside the app, Settings has a direct line to the admins.
        </p>
      </LegalSection>

      <LegalSection title="What is stored">
        <p>
          Your email address, username, and a scrambled (hashed) form of your password
          that cannot be turned back into the password. The photos, captions, comments,
          likes, and direct messages you create. Your profile picture, who you have
          blocked, and your notification preferences.
        </p>
        <p>
          If you turn on notifications, the address your browser gives for delivering
          them to that device. A sign-in record so you stay logged in. Photos are kept
          as you uploaded them, which can include details your camera embeds in the
          file, such as where a picture was taken.
        </p>
      </LegalSection>

      <LegalSection title="Who can see what">
        <p>
          Every member can see posts, captions, comments, likes, usernames and profile
          pictures. Direct messages are visible only to the two people in the
          conversation. Your email address is visible only to you and the admins.
          Nothing is visible to people without an account.
        </p>
        <p>
          The host has access to the machine the site runs on, and therefore to
          everything stored on it, including messages. Only share what you are
          comfortable sharing with the group and with the person hosting it.
        </p>
      </LegalSection>

      <LegalSection title="What is not done">
        <p>
          There are no ads, no tracking scripts, and no analytics services. The
          software does not send your data to its authors or to anyone else. The one
          outside service involved is your own browser&apos;s notification service
          (run by Apple, Google or Mozilla), and only if you turn notifications on.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <p>
          In Settings you can change your username, email and password, download a
          copy of your data, block members, and control notifications. Deleting your
          account removes your login, profile, posts and photos. Comments you left on
          other people&apos;s posts and messages you sent stay with the people who
          received them. The host can choose to keep copies of deleted photos on
          their own computer.
        </p>
        <p>
          Your browser keeps a small amount of data so the app opens quickly and stays
          signed in. Signing out or clearing site data in your browser removes it.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
