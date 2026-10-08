# NicheNet

Find products on Amazon that match your price, rating, review, and seller filters, and export them to Excel. The search runs in a tab in your own browser. There is no server and no paid API.

Seller-fulfilled products (the seller ships the item) are the default. Products shipped by Amazon are kept only if you change **Ships from**.

## Load it unpacked

1. From this folder, install dependencies and copy the local libraries and icons:

   ```bash
   npm install
   ```

2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose this folder (the one that contains `manifest.json`). Do not choose the `admin` folder.
5. Click the toolbar icon. A tab named **NicheNet** opens. Leave that tab open while a search is running.

`npm install` copies SheetJS, JSZip, and the Inter font into `vendor/` and writes the icons. Those files are part of the extension. Nothing is loaded from a CDN.

## Accounts

The extension asks for a sign-in before a search. An admin creates each person and sets:

- searches per day
- an optional cap on search pages
- an optional cap on results per product name
- whether the account is active

Pressing **Start** uses one search. At the daily limit, Start is refused until the admin raises the limit, clicks **Reset today**, turns the account back on, or the next UTC day begins.

The admin site is in the `admin` folder next to this one. From that folder:

```bash
npm install
npm run dev
```

Open the local address Vite prints. The admin password is created the first time you run `npm run accounts:setup` from the `admin` folder. That command creates the tables in Supabase. The database password stays in the gitignored `admin/.env` file and is not part of the extension.

The public Supabase anon key goes in `src/accountConfig.js` (`supabaseAnonKey`) and in `admin/.env` as `VITE_SUPABASE_ANON_KEY`. Copy it from the Supabase dashboard under Project Settings → API. Do not put the database password in either file.

## Use it

1. Type a product name and press **Enter** to add the next one (or click **Add product name**). Pasting a list with one product name per line fills one field per product name. Each product name is searched on its own and becomes its own results group and Excel sheet.
2. Set the price, minimum rating, and minimum reviews. Results are sorted by how close the review count is to **Target reviews**. There is no maximum review count. **Max search pages** can be any whole number of 1 or more.
3. Leave **Ships from** on **Not Amazon (seller ships it)** when you want seller-fulfilled products.
4. Enter a US ZIP and click **Set delivery location**, or just click **Start**. Either way the extension:
   - sets the Amazon currency cookie to USD
   - applies the ZIP the same way Amazon’s Deliver to box does
   - reads the homepage and will not search until that ZIP is shown
5. This changes the **Deliver to** location on your Amazon account in this browser.
6. Use **Pause**, **Resume**, and **Stop** while the tab stays open. **Stop** keeps whatever was already found.
7. If a yellow banner says Amazon wants to confirm you are human, solve that check in the Amazon tab, then come back. The search continues from the request that was blocked. The extension never solves a CAPTCHA for you.
8. **Download Excel** or **Download CSV**. Links in the workbook open `https://www.amazon.com/dp/<ASIN>`. Closing the tab and opening the extension again still has the last results.

**Save preset** stores the current filters under a name in local storage.

**History** in the top bar lists the newest 30 searches on this device. **Open** shows a past search again so you can download it as Excel or CSV. **Back to latest** returns to the last search.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Saves filters, presets, the last results, and search history on this device. |
| `tabs` | Opens the finder tab, focuses it if it is already open, and opens an Amazon tab when you need to solve a check or set the ZIP by hand. |
| `cookies` | Sets `i18n-prefs=USD` on `.amazon.com` so prices are in US dollars. Also sets the language cookie to English so rating and seller labels can be read. |
| `https://www.amazon.com/*` | Reads public search and product pages with your own Amazon session. |
| `https://yfuisdyvujfhbwlbqsoy.supabase.co/*` | Signs the user in and checks the daily search limit. Product pages are not sent there. |

No other hosts are allowed. Another marketplace (for example amazon.co.uk or amazon.ae) needs a new entry in `src/amazonConfig.js` and a matching host permission in `manifest.json`.

## Update selectors

Amazon changes its HTML. Every selector and URL pattern is in `src/amazonConfig.js`, with fallbacks in order. Edit that file, then click **Reload** on `chrome://extensions`. You do not need to rebuild.

- Search cards: `search.resultItem`, `search.sponsored`, `search.rating`, `search.reviewCount`
- Product page: `product.price`, `product.shipsFrom`, `product.soldBy`
- A normal search page must match one of `search.pageReady`. If Amazon renames the results container, add the new selector or every search will look like a block page.
- Delivery: `delivery.csrfPaths` and `delivery.jsonChangePaths` follow the Deliver to request. The ZIP is confirmed from `delivery.zipSelectors` (`#glow-ingress-line2`).

## Zip for the Chrome Web Store

```bash
npm run zip
```

From this folder, that writes `nichenet.zip`. Upload that zip. The package is the manifest, the finder page, `src/`, `vendor/`, and `icons/`.

The store listing’s single purpose is: “Find products on Amazon that match your price, rating, review and seller filters, and export them to Excel.”

## Checks

```bash
npm test
npm run test:e2e
```

`npm test` covers parsing, seller-fulfilled classification, the search job, delivery setup, CAPTCHA detection, and the Excel file. `npm run test:e2e` loads the extension in Chrome and runs a search against local stand-in Amazon pages, including Pause and the Excel download.

## Manual test checklist

1. Load the unpacked extension and open it from the toolbar. Confirm the notice **Keep this tab open while searching.**
2. Enter ZIP `10001` and click **Set delivery location**. Confirm the status line shows **Delivering to:** with `10001`, and that an Amazon page shows USD prices.
3. Enter `wooden floating shelves`, leave the other filters at their defaults (price $20–$40, rating 4.5, minimum reviews 100, target 200, ships **Not Amazon**, 10 results, 10 pages), and click **Start**.
4. Confirm the results table only shows rows whose seller column says **Seller ships it**.
5. Click **Pause** and confirm the progress line stops advancing. Click **Resume** and confirm it continues.
6. Click **Download Excel**. Open the file, confirm a frozen header and a price like `$24.00`, and click a link in the Link column. It should open `https://www.amazon.com/dp/<ASIN>`.
