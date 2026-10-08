# Privacy

NicheNet searches Amazon from your own browser. Accounts and daily search limits are stored in a Supabase project run for this extension.

- It loads public Amazon product and search pages with your browser, on your internet connection, using the Amazon session already in Chrome. Those pages are not uploaded to Supabase.
- Before a search it sets the Amazon currency to USD and applies the ZIP you enter. That changes the **Deliver to** location on your Amazon account in this browser. You can change it back on Amazon at any time.
- Your filters, named presets, the last results, and your search history (the newest 30 searches) are stored with `chrome.storage.local` on this device.
- Sign-in sends your email and password to Supabase so the extension can check them. Supabase stores the password only as a hash. A signed-in session token is kept on this device.
- Each time you press Start, the extension tells Supabase to count one search and to read your limits: searches per day, optional page and result caps, and whether the account is active. If the limit is reached, the search does not start.
- An admin can create accounts, change those limits, reset the day’s count, or pause an account. The admin signs in on a separate website with an admin password.
- The extension does not sell this information and does not send it to anyone other than that Supabase project.
- If Amazon shows a CAPTCHA or a “continue shopping” check, you solve it yourself in an Amazon tab. The extension does not try to solve it and does not use a CAPTCHA-solving service.

Permissions are `storage`, `tabs`, `cookies`, `https://www.amazon.com/*`, and the Supabase project host used for accounts.
