import { useEffect } from "react";

export default function Privacy() {
  useEffect(() => {
    document.title = "NicheNet privacy policy";
    return () => {
      document.title = "Admin";
    };
  }, []);

  return (
    <main className="page policy">
      <p><a href="/">Back to sign in</a></p>
      <h1>NicheNet privacy policy</h1>
      <p className="lede">This policy describes the NicheNet Chrome extension and the admin site that creates its accounts. Last updated October 7, 2026.</p>

      <h2>What NicheNet does</h2>
      <p>NicheNet searches public Amazon product pages in your own browser and exports the matches to Excel or CSV. An administrator creates each account and sets how many product searches that person can start per day.</p>

      <h2>Information the extension handles</h2>
      <ul>
        <li>Account email and password. The password is sent to our account server only to check it, and it is stored only as a hash.</li>
        <li>A sign-in token kept on this device so you stay signed in.</li>
        <li>How many searches you have used today, your daily limit, and whether the account is active.</li>
        <li>Activity from the extension: sign-in, sign-out, each search you start, when a daily limit is reached, and the log lines from that search, such as keywords, the delivery ZIP, pages checked, and how many products matched.</li>
        <li>Your filters, named presets, and the last results, stored on this device with Chrome’s local storage. Amazon page HTML is not uploaded.</li>
      </ul>

      <h2>Amazon</h2>
      <p>The extension loads public Amazon search and product pages with the Amazon session already in Chrome. Before a search it sets the Amazon currency cookie to USD and the language cookie to English, and it applies the ZIP you enter. That changes the Deliver to location on your Amazon account in this browser. You can change it back on Amazon at any time.</p>
      <p>If Amazon asks you to confirm you are human, you solve that check yourself. NicheNet does not solve CAPTCHAs and does not use a CAPTCHA-solving service.</p>

      <h2>Who can see it</h2>
      <p>Account data and activity logs are stored in a Supabase project operated for this extension. The administrator who created your account can see your email, daily limit, searches used, and activity log, and can reset the day’s count, change the limit, or delete the account. This information is not sold and is not sent to anyone other than that Supabase project.</p>

      <h2>Permissions</h2>
      <ul>
        <li><strong>storage</strong> — saves filters, presets, the last results, and the sign-in token on this device.</li>
        <li><strong>tabs</strong> — opens the NicheNet tab and an Amazon tab when you need to solve a check or set the ZIP yourself.</li>
        <li><strong>cookies</strong> — sets the currency and language cookies on amazon.com.</li>
        <li><strong>https://www.amazon.com/*</strong> — reads public search and product pages.</li>
        <li><strong>The Supabase host for this extension</strong> — signs you in, counts searches, and stores the activity log.</li>
      </ul>

      <h2>How long it is kept</h2>
      <p>Local filters and results stay on the device until you clear the extension’s storage or remove the extension. Account records and activity logs stay until an administrator deletes the account. Deleting an account removes that person’s stored activity.</p>

      <h2>Contact</h2>
      <p>To ask for your account or activity log to be deleted, contact the administrator who gave you access to NicheNet.</p>
    </main>
  );
}
