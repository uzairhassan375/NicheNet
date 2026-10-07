export function searchResultsPage(items) {
  const cards = items
    .map(
      (item) => `
      <div data-component-type="s-search-result" data-asin="${item.asin}">
        ${item.sponsored ? '<span class="puis-sponsored-label-text">Sponsored</span>' : ""}
        <h2><span>${item.title}</span></h2>
        <span aria-label="${item.rating} out of 5 stars">${item.rating} out of 5 stars</span>
        <a href="/dp/${item.asin}#customerReviews"><span>(${item.reviewsLabel})</span></a>
        <span class="a-price"><span class="a-offscreen">${item.price}</span></span>
      </div>`,
    )
    .join("");
  return `<!doctype html><html><head><title>Amazon.com : search</title></head><body><div id="search"><div class="s-main-slot">${cards}</div></div></body></html>`;
}

export function productResultPage({
  price = "$24.00",
  rating = "4.8",
  reviews = "180",
  shipsFrom = null,
  merchant = "Shipper / Seller Tayfus",
} = {}) {
  const ships =
    shipsFrom == null
      ? ""
      : `<div id="fulfillerInfoFeature_feature_div"><span class="offer-display-feature-text">${shipsFrom}</span></div>`;
  return `<!doctype html><html><head><title>Product</title></head><body>
    <span id="productTitle">Product</span>
    <div id="corePrice_feature_div"><span class="a-offscreen">${price}</span></div>
    <div id="acrPopover"><span class="a-icon-alt">${rating} out of 5 stars</span></div>
    <span id="acrCustomerReviewText">${reviews}</span>
    ${ships}
    <div id="merchantInfoFeature_feature_div">${merchant}</div>
  </body></html>`;
}

export function homePage(line2) {
  return `<!doctype html><html><head><title>Amazon.com</title></head><body>
    <span id="glow-ingress-line1">Deliver to</span>
    <span id="glow-ingress-line2">${line2}</span>
  </body></html>`;
}

export const SAMPLE_SEARCH = [
  {
    asin: "B0SPONSOR1",
    title: "Sponsored shelf ad",
    rating: "4.8",
    reviewsLabel: "200",
    price: "$25.00",
    sponsored: true,
  },
  {
    asin: "B0LOW00001",
    title: "Cheap shelf",
    rating: "3.2",
    reviewsLabel: "200",
    price: "$25.00",
  },
  {
    asin: "B0FBM00001",
    title: "Wooden Floating Shelves Walnut",
    rating: "4.8",
    reviewsLabel: "180",
    price: "$25.00",
  },
  {
    asin: "B0FBA00001",
    title: "Boxed shelf from the warehouse",
    rating: "4.9",
    reviewsLabel: "200",
    price: "$30.00",
  },
  {
    asin: "B0FBM00002",
    title: "Oak serving board",
    rating: "4.7",
    reviewsLabel: "400",
    price: "$22.00",
  },
  {
    asin: "B0FBM00003",
    title: "Wooden Floating Shelves Walnut Large",
    rating: "4.8",
    reviewsLabel: "180",
    price: "$26.00",
  },
];
