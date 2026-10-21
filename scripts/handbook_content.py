"""Long-form Sokoni Mall platform handbook chapters."""


def build_blocks():
    b = []

    def h1(t):
        b.append(("h1", t))

    def h2(t):
        b.append(("h2", t))

    def h3(t):
        b.append(("h3", t))

    def p(t):
        b.append(("p", t))

    def toc(t):
        b.append(("toc", t))

    def note(title, body):
        b.append(("callout", (title, body)))

    def tbl(headers, rows, widths=None):
        payload = (headers, rows) if widths is None else (headers, rows, widths)
        b.append(("table", payload))

    # ------------------------------------------------------------------
    h1("Contents")
    for line in [
        "1. How to use this handbook",
        "2. What Sokoni Mall is",
        "3. How the whole system fits together",
        "4. Brand, voice, and design",
        "5. The website, page by page",
        "6. Accounts, login, and the browse gate",
        "7. Catalog, browse, search, shops, and the feed",
        "8. The WhatsApp bot",
        "9. Buyers — the full journey",
        "10. Checkout, M-Pesa, and what the buyer pays",
        "11. Escrow, inspection, refunds, and disputes",
        "12. Tracking, labels, and shipment status",
        "13. Sellers — from first listing to payout",
        "14. Listing quality, stock, photos, and promos",
        "15. Riders — joining, jobs, OTPs, and earnings",
        "16. Pickup point partners",
        "17. Logistics and delivery pricing",
        "18. Multi-seller carts",
        "19. AI: Sokoni Plug, specialists, and tools",
        "20. Background agents, ops, media, and voice",
        "21. About, FAQ, trust, terms, and privacy",
        "22. Hosting, the production VM, and operations",
        "23. Commands in real conversations",
        "24. Official contacts and how to verify the business",
        "Worked examples (search to payout, upcountry, first seller, first rider)",
        "When payment, dispatch, or delivery fails",
        "Inbox, offers, bundles, and the social shop",
        "Order statuses, from unpaid to paid out",
        "Browse departments and merchandising",
        "Public APIs the website already calls",
        "WhatsApp menus, language, and a sample thread",
        "Staff desks, catalog publishing, motion, and data protection",
        "Policy files, clocks, Seller Hub, checkout fields, and application forms",
        "A Plug turn, more conversations, metro meaning, reviews, clips, backups",
        "History: from affiliate mall to prepaid escrow",
        "Money examples, languages, fraud holds, labels, accounts, high-value orders",
        "Instant listing, rider workspace, and design rules",
        "25. Glossary",
    ]:
        toc(line)

    note(
        "What this handbook is",
        "This is a narrative description of the live Sokoni Mall product. "
        "It follows a buyer, a seller, a rider, and a pickup shop through the "
        "same money, the same SKN numbers, and the same WhatsApp thread. "
        "Where older files in the repository still describe an affiliate mall "
        "that sent people to Jumia or AliExpress, this handbook describes what "
        "the site, bot, and FAQ actually do today: local Kenya inventory, "
        "prepaid M-Pesa, and escrow until delivery.",
    )

    # ------------------------------------------------------------------
    h1("1. How to use this handbook")
    p(
        "Sokoni Mall is easy to use and hard to explain in one paragraph, because "
        "it is not only a website. It is a storefront, a WhatsApp shop, a prepaid "
        "escrow desk, a seller hub, a boda dispatch board, and a set of AI tools "
        "that share one catalog. This handbook exists so that anyone who needs "
        "the whole picture — founder, operator, support, partner, or future teammate — "
        "can read it as a book instead of hunting through HTML pages and bot knowledge files."
    )
    p(
        "Read it front to back the first time. After that, jump by role. Buyers live "
        "in chapters 9 to 12. Sellers live in 13 and 14. Riders live in 15. Pickup "
        "partners live in 16. Money and disputes live in 10 and 11. The AI stack "
        "lives in 19 and 20. Hosting lives in 22. Legal copy that already appears "
        "on sokonimall.com is restated in chapter 21 so you do not have to open five tabs."
    )
    p(
        "Examples use the public order pattern already shown on the FAQ, such as "
        "SKN-1002 for a parent order and SKN-1002-1 for a cart line. Those are "
        "formats, not live customer records. Amounts are in Kenyan shillings. "
        "Times are East Africa Time unless a window is counted in hours from an event."
    )
    p(
        "The live pages remain the contract with customers: about.html, faq.html, "
        "trust-and-safety.html, terms.html, and privacy.html. If a sentence here "
        "and a sentence there ever drift, the dated legal page wins for customers, "
        "and this handbook should be regenerated from the product."
    )

    # ------------------------------------------------------------------
    h1("2. What Sokoni Mall is")
    p(
        "Sokoni Mall is a Kenyan peer-to-peer marketplace for brand-new merchandise "
        "and pre-loved fashion and lifestyle goods. The public tagline is Kenya's "
        "number one prepaid marketplace for brand new and pre-loved fits. Shoppers "
        "do not download a custom shopping app. They open sokonimall.com in a browser, "
        "or they message Sokoni Plug on WhatsApp at +254 117 422 428, and they talk "
        "the way they already talk: English, Kiswahili, Sheng, or a mix of the three."
    )
    p(
        "The legal business name is SKN MALL KENYA, registration BN-36SM2YW9, issued "
        "on 4 September 2026 by the Business Registration Service of the Republic of "
        "Kenya under the Registration of Business Names Act, Cap. 499. The trade name "
        "customers see is Sokoni Mall, sometimes written Sokoni Mall Enterprise. The "
        "registered office on the BRS record is Murang'a Union Building, Thika–Kandara "
        "Road, P.O. Box 220, 01034 Kandara. That address proves the business exists. "
        "It is not a claim that Sokoni only serves one town. The marketplace sells "
        "and delivers countrywide: home delivery where a Sokoni rider can run, courier "
        "and waybill where the seller ships upcountry, and collection from pickup shops."
    )
    p(
        "The product promise is simple enough to say in a shop: you pay first, but you "
        "are not paying the seller. You pay Sokoni. Sokoni holds the money. The parcel "
        "moves. You look at it. If it is what you bought, the seller (and the rider, on "
        "local jobs) get paid. If it is not, you say so on WhatsApp, the payout freezes, "
        "and support works from photos and the SKN number. There is no cash on delivery. "
        "That is not a gap. It is the design. Cash at the door leaves no record and no "
        "way back. Escrow leaves both."
    )
    p(
        "Every catalog order gets a tracking code. A single-item order looks like SKN-1002. "
        "A bag that mixes two sellers still pays once, but splits into lines such as "
        "SKN-1002-1 and SKN-1002-2 so each shop can pack, dispatch, and get paid on its "
        "own goods. Older SK-#### codes from earlier builds still open on the track page "
        "and in WhatsApp. Catalog product ids (the listing itself) are separate from SKN "
        "numbers. SKN is the order. The listing id is the thing on the shelf."
    )
    h2("What customers are actually buying")
    p(
        "They are buying local Kenya inventory from people who listed on Sokoni: a "
        "pre-loved jacket, a new pair of sneakers, a beauty item, a phone accessory, "
        "whatever the live catalog holds that day. The FAQ is explicit that Sokoni does "
        "not route shoppers to AliExpress, Temu, or Amazon, and does not handle import "
        "duty for overseas parcels. Some older documents in the repository still talk "
        "about an affiliate mall. That was an earlier concept. The live catalog path "
        "is fulfillment of the store type, payment prepaid, sellers on the platform."
    )
    p(
        "There is still a curated-store idea in internal notes, where an operator could "
        "list winning wholesale items at a selling price and fulfil them as Sokoni Store. "
        "Customers never see the words reseller or dropship. They see a prepaid listing "
        "with a KES price and an order button. Seller-generated shops are the marketplace "
        "shape people meet on the website: public shop pages, follows, offers, inbox chat."
    )
    h2("What Sokoni is not")
    p(
        "It is not a cash-on-delivery courier app. Riders are not sent to collect money. "
        "A rider who asks a buyer for cash or M-Pesa is outside the product, and the buyer "
        "should report it in the same WhatsApp chat. It is not an overseas shopping agent. "
        "It is not a Next.js storefront. The site is static HTML, CSS, and JavaScript, "
        "with a small React and Framer Motion bundle that only adds motion. If that bundle "
        "fails, browse, search, pay, and track still work. It is not a place where the "
        "language model is allowed to release money, invent a till, or type an OTP."
    )
    h2("Mission")
    p(
        "The About page states the mission as making trusted local commerce feel as easy "
        "as texting a friend. That sentence is the brief for every surface. Product cards "
        "lead with the KES amount, then escrow, then the action. Support copy is short. "
        "Green is for doing something. Cream and deep purple are for reading. The country "
        "is Kenya, not a single city campaign. When delivery is discussed, the text talks "
        "about home delivery and pickup across the country, not a Nairobi-only mall."
    )

    # ------------------------------------------------------------------
    h1("3. How the whole system fits together")
    p(
        "Two public hostnames carry almost everything a customer touches. sokonimall.com "
        "is the website: discovery, trust, accounts, shop pages, checkout screens, tracking, "
        "seller hub, rider apply, pickup apply, and the legal pages. bot.sokonimall.com is "
        "the commerce engine: catalog API, payments, escrow state, WhatsApp webhooks, "
        "seller onboard APIs, disputes, tracking JSON, and Sokoni Plug. The website is "
        "mostly files. The bot is a long-running Node process. They share one idea of a "
        "product, one idea of an order, and one WhatsApp number."
    )
    p(
        "A shopper can live entirely on WhatsApp. They message Hi, they get a numbered "
        "menu or they type what they want in Sheng, they see product cards with photos "
        "and prices, they order, they receive an M-Pesa STK prompt, they enter their PIN "
        "on the Safaricom screen, they later type track or paste SKN-1002, and if the "
        "parcel is wrong they type HELP SKN-1002. The website is not required for that "
        "path. The website exists so people can browse like a fashion app, share a shop "
        "link, print a label, reset a password, or read terms before they pay."
    )
    p(
        "WhatsApp itself is not hosted by Meta Cloud API in this stack. The production "
        "bot talks to WAHA, a self-hosted WhatsApp HTTP service running in Docker on the "
        "same virtual machine as the Node app. nginx terminates HTTPS for bot.sokonimall.com. "
        "WAHA's own admin port is not published to the internet. Pairing the business "
        "phone happens on the machine. After that, inbound messages hit the bot webhook, "
        "and outbound replies go back through WAHA. Numbered text menus are the reliable "
        "interaction. Interactive buttons exist in older flow notes; operations treat "
        "them as unreliable, so the live habit is reply 1, reply 2, or type a command."
    )
    p(
        "Payments land through M-Pesa STK. The privacy policy names Paystack for collections "
        "and seller payouts, and Safaricom Daraja as an optional STK path. From the buyer's "
        "point of view there is one behaviour: a prompt appears on the phone that paid, "
        "the PIN is entered there, and the SKN order moves from awaiting payment to paid. "
        "If STK fails, checkout can fall back to a Buy Goods till shown on that screen, "
        "and the buyer replies paid with the M-Pesa confirmation so Sokoni can match it. "
        "The till is never a number a stranger pastes in chat, and it is never a rider's phone."
    )
    p(
        "Orders can be stored as files on the bot and, when configured, mirrored into "
        "PostgreSQL. The multi-seller cart was designed to extend the file-backed order "
        "book first so a live bag did not wait on a greenfield database rewrite. Users, "
        "social graphs, riders, and additive schemas sit more naturally in Postgres. If "
        "the database is not configured, the catalog can still be served from products.json. "
        "The public website catalog is a published slice of the master catalog with private "
        "sourcing fields stripped so a browser never sees what an item cost the operator."
    )
    p(
        "Around the customer path sit desks that customers should not need: admin command "
        "for escrow and live orders, finances, disputes, flagged listings and KYC, shops, "
        "boda verification, support commands, and a live ops view. Those pages are not "
        "in the public nav. This handbook explains that they exist and what job they do. "
        "It does not explain how to log into them."
    )
    tbl(
        ["Layer", "Where it lives", "What it is for"],
        [
            [
                "Storefront",
                "sokonimall.com on Cloudflare",
                "Browse, accounts, shops, checkout UI, track, legal, seller hub, boda and pickup apply.",
            ],
            [
                "Motion",
                "Built JS on the same site",
                "Fail-soft animation. Catalog and auth keep working without it.",
            ],
            [
                "Bot and APIs",
                "bot.sokonimall.com on the VM",
                "Orders, STK, escrow, WhatsApp, Plug, seller and rider APIs.",
            ],
            [
                "WhatsApp transport",
                "WAHA on the VM",
                "Session for +254 117 422 428. Not a public website.",
            ],
            [
                "Money",
                "M-Pesa STK into escrow",
                "Held until confirm or dispute. Seller and rider paid after.",
            ],
        ],
        [32, 48, 90],
    )

    # ------------------------------------------------------------------
    h1("4. Brand, voice, and design")
    p(
        "Sokoni should feel like texting a trusted local shop assistant, not like a "
        "corporate landing page. Sentences are short. Examples are real: SKN numbers, "
        "M-Pesa STK, pickup partners, prepaid labels. English, Kiswahili, and Sheng are "
        "welcome where they are natural. Marketing does not anchor to a single city. "
        "Hollow words — seamless, leverage, ecosystem, world-class — are out of voice."
    )
    p(
        "Colour has jobs. WhatsApp green, #25D366, is for actions: Start on WhatsApp, "
        "Order, pay, success. It is not for large backgrounds or for every heading. "
        "The cream surface #FFF8F0 is for reading. Deep purple #1B1035 is for type. "
        "The main shop shell also uses a dark Depop-inspired frame and a red accent on "
        "some shop chrome; those sit beside the cream-and-green tokens rather than replacing "
        "the rule that green means do something. Display type is Fraunces. Body and UI "
        "type is DM Sans. Spacing sits on an eight-pixel grid. Primary buttons prefer "
        "forty-eight pixels of height so a thumb can hit them."
    )
    p(
        "Product cards are a hierarchy, not a collage: escrow or prepaid cue, image, title, "
        "KES amount in a size you cannot miss, then the buy action and the ask-on-WhatsApp "
        "link. Search fields are large and use plain-language placeholders. Chat previews "
        "on marketing pages use the WhatsApp header, incoming white bubble, and outgoing "
        "green bubble tokens so a mock thread looks like the real app. Touch targets stay "
        "at least forty-four pixels. Reduced-motion preferences are honoured: hover scale "
        "turns off, and the motion bundle falls back to opacity or nothing."
    )
    p(
        "The motion layer is Path B: keep the vanilla site, add React and Framer Motion "
        "as a deferred script. Animations are opacity and transform only — no height or "
        "margin tricks that jank on mid-range Android. Product grids that app.js already "
        "owns are enhanced in place so event listeners are not destroyed. If the script "
        "errors, the shop is still a shop."
    )
    p(
        "Copy about money prefers 'your money is safe until you confirm' over 'cashless "
        "seamless checkout'. Till numbers are not printed on the storefront. The official "
        "pay path is the STK prompt from checkout or WhatsApp, tied to the SKN the buyer "
        "already has."
    )

    # ------------------------------------------------------------------
    h1("5. The website, page by page")
    p(
        "The storefront is a folder of HTML pages under website/, styled with design tokens, "
        "a small CSS layer, Tailwind from a CDN, and the Depop-inspired shell on the main "
        "shop. There is no build step to put the site on Cloudflare. You deploy the folder. "
        "JavaScript talks to bot.sokonimall.com for live products, search, reviews, checkout, "
        "accounts, and Plug. Static JSON under website/data/ is a fallback and a source for "
        "browse menus, site story, and featured TikTok ids."
    )
    h2("Home — index.html")
    p(
        "Home is the catalog. It is also the strictest door: by default the account gate "
        "is hard, so a visitor who is not signed in is sent to log in before they browse. "
        "Once inside, the page is a fashion marketplace: a category rail from browse-menu.json, "
        "hero stories, a trust ticker fed by the bot, brand and promo chips, top shops, "
        "Explore versus Following tabs, new arrivals, collections, and marketing blocks "
        "for how it works and why sell. Search sits in the header and in the hero. Filters "
        "cover brand new versus pre-loved, aesthetics such as Y2K, streetwear, vintage, "
        "clean girl, and price tiers under one thousand, two thousand five hundred, five "
        "thousand, and ten thousand shillings. Decade chips exist for thrift browsing."
    )
    p(
        "Opening a product does not usually navigate to a separate product URL. A sheet "
        "slides over the grid with images or a clip, the KES price, escrow language, like, "
        "make an offer, and WhatsApp deep links that already contain the item in the prefilled "
        "message. After JavaScript injects cards, a small component helper upgrades them so "
        "behaviour stays consistent. The bag on the site can hold items from more than one "
        "seller; checkout and WhatsApp both understand that bag."
    )
    h2("Shop profiles — shop.html")
    p(
        "A seller shop is a public page by handle. You can share it without logging in. "
        "It shows avatar, bio, trust badges, live listings, follow, reviews, and a path "
        "into offers. A TikTok URL, if the seller added one, is a public link on this page, "
        "not a dump of private chat. This is the Depop-shaped unit of reputation: people "
        "follow a shop, not only a SKU."
    )
    h2("Ask Plug — ask.html")
    p(
        "Ask is the website mouth of the same brain that answers WhatsApp. It posts to "
        "/api/agent/chat. It is good for 'do you have a linen shirt under 2500' and for "
        "'where is SKN-1002'. It is not a second checkout. The page still points people "
        "to WhatsApp or the prepaid checkout when they are ready to pay, because STK, "
        "OTP, and escrow live on the order, not in a floating web widget."
    )
    h2("Account pages")
    p(
        "login.html is the combined landing: email and password, a signup modal, and a "
        "teaser of the assistant. signup.html simply opens that modal. forgot-password.html "
        "starts a reset. reset-password.html accepts the token from the email link. profile.html "
        "is the signed-in hub: edit profile, purchases, saved items, and links into inbox, "
        "activity, and track. If you are signed out, profile shows calls to action rather "
        "than a hard bounce, depending on the gate mode."
    )
    h2("Checkout, track, inbox, disputes, activity")
    p(
        "checkout.html is prepaid checkout for people who started on the web. It looks up "
        "an order, shows whether it is ready to pay, lets the buyer pick county, town, "
        "landmarks, or a map pin, applies shipping, and sends STK. Accepted-offer checkout "
        "reuses the same money path so a negotiated price is not a side deal. track.html "
        "is public. Anyone with the SKN can see the timeline. When a rider is on the job "
        "and location sharing is on, a map can appear. inbox.html is buyer–seller messaging: "
        "threads, offers, bundles, photos, voice, inspection and release actions. disputes.html "
        "lists the buyer's order-protection cases. activity.html is likes, follows, and "
        "notification preferences for a signed-in buyer."
    )
    h2("Labels and QR")
    p(
        "label.html prints the prepaid drop-off label and QR after payment. Sellers and "
        "hubs use it so a parcel can be scanned without rewriting the order number. qr.html "
        "is a short path to the same idea. rider/scan.html helps a rider connect a scanned "
        "code to the PICKUP command they must type on WhatsApp. The printable waybill URL "
        "the assistant is allowed to quote is the label page with the order query, not an "
        "invented path."
    )
    h2("Seller Hub — suppliers/list.html")
    p(
        "This is the seller's actual workplace on the web. WhatsApp OTP proves the phone. "
        "From here a seller drafts and publishes listings, runs the photo studio, bulk-uploads, "
        "edits shop profile and avatar, sets payout details, watches orders and the ledger, "
        "requests a withdraw, sets shipping zones, asks for a boda pickup, manages stock and "
        "variants, sets a percent promo on an item, and answers disputes. The path is public "
        "in the sense that it is not behind the home browse gate. The data behind it is not "
        "public. You only see your shop."
    )
    h2("Boda and pickup marketing")
    p(
        "boda/index.html is the recruitment story: escrow-backed WhatsApp jobs, accept, "
        "pickup, deliver, M-Pesa after CONFIRM. Photos on that page are candid rider work, "
        "not stock models. boda/apply.html is the web form. boda/dashboard.html is a reference "
        "workspace that shows command patterns; live jobs still arrive on WhatsApp after "
        "verification. pickup-points.html explains the partner programme: already-paid parcels "
        "arrive at a shop, customers collect, the shop earns commission. pickup-points/apply.html "
        "is the application. Commission on the marketing page is described as KES 50 plus "
        "per parcel, with the exact rate confirmed on approval and weekly M-Pesa for verified points."
    )
    h2("Legal and company")
    p(
        "about.html is the company story, mission, how Sokoni works, sell link, and the full "
        "BRS table plus how to SMS BRS to 21546. faq.html is the practical handbook for "
        "shoppers: no COD, STK, escrow windows, tracking, selling, SOKONI3, safety, support "
        "hours. trust-and-safety.html answers 'is this legit' in public: STK into escrow, "
        "two-hour inspection photo, twelve-hour no-dispatch refund, HELP if a delivery is "
        "fake. terms.html is the contract, last updated 27 July 2026. privacy.html is the "
        "data policy, same date. Chapter 21 walks those pages in full sentences."
    )
    h2("Staff desks")
    p(
        "A set of admin HTML pages exists for people who already operate the platform: "
        "live escrow and orders, a socket ops desk, support commands, finances and release, "
        "disputes, flagged listings and KYC, shops, boda verification and payout runs, "
        "and a riders desk. They are noindex. They are not linked from the customer footer. "
        "They are how humans resolve the cases Plug is forbidden to settle with a made-up amount."
    )

    # ------------------------------------------------------------------
    h1("6. Accounts, login, and the browse gate")
    p(
        "Sokoni has two customer identity layers because the website and WhatsApp prove "
        "different things. The site account is email and password. It is what the browse "
        "gate checks. It holds profile, purchases, saved items, inbox, and activity. The "
        "API family is /api/account/auth: signup, login, session, profile patch, purchases, "
        "sign-out, forgot password, reset password. The browser keeps a session in local "
        "storage after a successful login."
    )
    p(
        "The second layer is a buyer WhatsApp OTP. Offers and some pay flows need a Kenyan "
        "phone that Sokoni has challenged with a code. That is /api/buyer/auth send-code "
        "and verify-code. A person can have a website account and still need to prove the "
        "phone before an offer is binding, because escrow and STK are tied to M-Pesa, which "
        "is tied to a number, not to an email."
    )
    p(
        "Sellers have a third flavour of the same idea: Seller Hub sends a code to the "
        "WhatsApp number, the seller types it, and onboard APIs then allow listings, ledger, "
        "withdraw, dispatch, and stock. Messaging SELL from that number on WhatsApp is even "
        "stronger proof, because the message already came from the phone. Riders applying "
        "in chat use the same principle: the Kenyan number they apply with is the number "
        "that will receive job offers and M-Pesa."
    )
    p(
        "The account gate on the site has three moods: off, soft, and hard. They can be "
        "set by a query flag, local storage, or a meta tag. Home is hard. That is why a "
        "new visitor hitting the catalog is asked to sign in. Always-public pages include "
        "login and signup, password reset, track, labels, legal pages, the seller hub URL, "
        "public shop pages, pickup pages, and boda apply. Inbox, activity, disputes, and "
        "checkout sit in the soft-protected set: in hard or soft mode they want a login. "
        "Track stays public so a buyer can paste a link without creating an email account."
    )
    p(
        "None of these layers collect an M-Pesa PIN. Privacy policy language is blunt: "
        "Sokoni does not collect M-Pesa PINs, card numbers, or passwords through WhatsApp "
        "or the website. The PIN belongs on the STK screen Safaricom shows. If a message "
        "in chat asks for a PIN, it is not Sokoni Plug behaving as designed."
    )

    # ------------------------------------------------------------------
    h1("7. Catalog, browse, search, shops, and the feed")
    p(
        "The catalog is one of the few things the website and the bot must never disagree "
        "on. Master data lives with the bot. A build publishes a public JSON for the site "
        "and strips private cost and supplier fields. Listings carry a selling price in "
        "KES, condition (brand new or pre-loved), photos or a clip, stock or variants, "
        "browse categories, a seller handle when the item belongs to a shop, and flags "
        "that mark prepaid store fulfillment. Liked items, reviews, and demand tags hang "
        "off those ids."
    )
    p(
        "Browse is not a flat list of ten categories. browse-menu.json version 9 is a tree. "
        "At the top you can still choose All Items, Brand New, or Pre-Loved / Thrift. Price "
        "tiers and decades sit beside aesthetics: Y2K, streetwear, vintage, clean girl, "
        "cyberpunk, goth and punk, nineties thrift, minimalist, festival, graduation, party "
        "fits, crochet, linen, official wear. The department tree includes Women (tops, "
        "dresses, skirts, jumpsuits, jeans, outerwear, activewear, sleepwear, lingerie, "
        "maternity, shoes, heels, and more), and parallel trees for men, beauty, electronics, "
        "supermarket, auto, food, wine, and other aisles as the menu grows. WhatsApp Plug "
        "can call browse_taxonomy and browse_products so 'women dresses under 2500' hits "
        "the same aisle the website rail uses."
    )
    p(
        "Search on the site is GET /api/search. Plug search is the search_products tool, "
        "which understands budget language such as under five thousand, pre-loved, and "
        "aisle hints. Zero live matches must be said as zero live matches. The assistant "
        "is forbidden from inventing a sample table of products to look helpful."
    )
    p(
        "The home feed is behaviour-ranked, not a static merchandising grid. The site posts "
        "anonymous events: view, click, save, unsave, purchase. Those signals decay over "
        "about seventy-two hours. Global trending rebuilds about hourly. Home rails include "
        "Picked for you, Trending in Kenya, under-five-thousand and under-two-thousand-five-hundred "
        "shelves, pre-loved picks, and brand-new drops. Explore versus Following lets a "
        "signed-in shopper see the network they actually follow. TikTok featured ids are "
        "a small JSON the bot can refresh when social posting is on; the site then can "
        "highlight those products without putting private messages on TikTok."
    )
    p(
        "Social commerce is more than a grid. Buyers like listings, follow shops, send "
        "offers, build bundles, and talk in the inbox with photos and voice. A close offer "
        "from a buyer who already has a record can nudge the seller on WhatsApp, with a "
        "rate limit so shops are not spammed. Offers are not a way around escrow. When "
        "an offer is accepted, checkout still holds the money until delivery. Shop reviews "
        "are attached to delivered orders so a rating is not an anonymous drive-by."
    )

    # ------------------------------------------------------------------
    h1("8. The WhatsApp bot")
    p(
        "The WhatsApp number is the shop floor. Support, Plug, rider commands, seller "
        "commands, and 'talk to a human' all share it. The bot is an Express app. Inbound "
        "messages arrive as a webhook. Before any model runs, a command router looks for "
        "things that move money or custody: ACCEPT, PICKUP, CONFIRM, WAYBILL, PARTIAL_REFUND, "
        "pay, paid, track, HELP, DISPUTE, YES, RATE, SELL, RIDER APPLY, vendor menu, pickup "
        "menu, balance, WITHDRAW, numbered menu replies, and staff-only palettes. If a line "
        "is a command, code handles it. The language model is not asked to parse an OTP."
    )
    p(
        "If the line is ordinary language, Sokoni Plug runs. Plug is shared with ask.html. "
        "It is instructed to sound like a Kenyan shop assistant: low temperature, two to "
        "five short sentences on WhatsApp, bold for SKN numbers and KES amounts, no walls "
        "of text, no markdown tables of orders, URLs on their own line so WhatsApp does "
        "not break them. It answers in the language the person used. It must not loop the "
        "user back to the same WhatsApp number they are already on. Sign-up for riders and "
        "sellers is a form or an in-chat apply, not 'message support'."
    )
    p(
        "Menus still matter. A new shopper who sends menu, hi, or start should get a clear "
        "fork: browse, deals, track, talk to a human, how it works. Category browse is "
        "numbered. Product cards go out as photo plus caption plus numbered actions: order, "
        "ask about this, back. Typing menu resets an in-progress browse so people are not "
        "trapped in a subcategory. Free text can interrupt: 'naeza pata original Air Force "
        "chini ya 6k?' should search, not demand that the person pick 3 from a list first."
    )
    p(
        "Rate limits protect the model and the number. About ten messages a minute per user "
        "is the documented WhatsApp cap; faster spam gets a static reply. IP limits sit on "
        "the HTTP webhook. Health is a public GET /health on the bot host so operators can "
        "see whether WAHA is linked without opening the session UI."
    )
    p(
        "Voice notes inbound are transcribed and then treated as text, so a rider who cannot "
        "type CONFIRM carefully still has to land on the command, but a shopper asking "
        "'iko delivered?' in a voice note gets the same tracker as a typed line. Outbound "
        "voice is optional and only when someone asks to hear a reply; the default is text. "
        "Human support hours are about 07:30 to 21:00 EAT via Talk to a Human. Outside those "
        "hours Plug and tracking still work. Anger, legal threats, or fraud claims escalate "
        "to a human in the same thread."
    )
    p(
        "The bot's knowledge folder is the policy brain for RAG: escrow, payments, returns, "
        "buyer trust, seller onboarding and payouts, vendor terms, rider onboarding, delivery, "
        "earnings, delivery pricing, shipping SOP, location pins, and the four-tier AI note. "
        "Updating those files updates what Plug may say. It does not retrain a private model. "
        "It is an instruction manual, not a personality wipe."
    )

    # ------------------------------------------------------------------
    h1("9. Buyers — the full journey")
    p(
        "Imagine a buyer in Kisumu who saw a pre-loved linen set on TikTok and a buyer in "
        "Ruiru who opened sokonimall.com on Wi-Fi. They are the same product. One will chat. "
        "One will browse. Both will pay STK. Both will get an SKN. Both will inspect before "
        "they release. This chapter follows them without pretending the clicks are identical."
    )
    h2("Starting on the website")
    p(
        "The Kisumu buyer who hits home while logged out is asked to create or enter an "
        "email account because home is hard-gated. After login they search linen, filter "
        "pre-loved, open a sheet, like it, maybe follow the shop. If the price is high they "
        "can make an offer, which may require WhatsApp OTP so the shop is not negotiating "
        "with a throwaway email. If the price is right they add to bag. The bag can already "
        "hold a pair of sneakers from a second shop. Checkout will later make that one STK "
        "and two child SKNs."
    )
    p(
        "They can also tap Order or Ask on WhatsApp from the sheet. The wa.me link is "
        "+254 117 422 428 with a prefilled line that names the item. That is the handoff: "
        "the site did discovery, WhatsApp will do talking and often paying. FAQ language "
        "tells them to verify the SKN on that number before they pay anything."
    )
    h2("Starting on WhatsApp")
    p(
        "The Ruiru buyer saves the contact from a flyer or a bio link and says 'sasa, mko "
        "na original samba 41?'. Plug searches the live catalog. If there are matches, they "
        "come back as real listings with KES prices, not a fantasy table. The buyer can "
        "order from the numbered card. The bot collects a name, a phone if it is not already "
        "the WhatsApp number, and a delivery location. A map pin is better than a typed "
        "estate name because local rider pricing and the door GPS check both use coordinates. "
        "A county and town still let the order through. A pin that is 0,0, swapped, or outside "
        "Kenya is refused. A wrong pin is worse than none: it prices the trip with confidence "
        "and can lock a rider out at a gate they are physically at."
    )
    h2("Paying")
    p(
        "When the order exists it is awaiting payment. STK should fire on its own. The "
        "phone that will pay gets a prompt. The buyer enters the PIN on that prompt. Sokoni "
        "never asks for the PIN in chat. On success the catalog item is locked as needed, "
        "a label becomes possible, the seller is notified, and tracking can start. If the "
        "prompt never arrived, the buyer types pay or stk or lipa. If they paid a till shown "
        "on checkout because STK failed, they type paid and the confirmation code. They do "
        "not send money to a number a rider reads out. They do not send money to the seller's "
        "personal till. Promo code SOKONI3, during beta, is up to three percent off eligible "
        "prepaid orders. Automated messaging will not invent free-delivery vouchers or flat "
        "shilling discounts beyond that cap."
    )
    h2("Waiting")
    p(
        "Paid local metro orders can be offered to a Sokoni rider. The buyer does not pick "
        "the rider. Upcountry orders wait on the seller to dispatch by courier and to send "
        "WAYBILL with two photos. If twelve hours pass with no dispatch, the buyer is owed "
        "a refund and the seller is not paid. The buyer can type the SKN or track at any "
        "time. The track page shows label, hub, in transit, pickup or delivered. Rider contact "
        "appears when a rider has accepted. Order status does not require a human. 'Where "
        "is my order' is a tracker question, not a ticket."
    )
    h2("At the door, or at the pickup shop")
    p(
        "Local rider: the parcel arrives. The buyer looks at it. If it is right, they speak "
        "the four-digit Delivery OTP. The rider types CONFIRM SKN-1002 7391 and shares GPS. "
        "Both proofs are required. If the item is wrong, the buyer does not hand over the "
        "OTP. They photograph the problem. Trust-and-safety copy gives a two-hour inspection "
        "window in which a saved photo freezes seller payout. Knowledge and FAQ also describe "
        "a twenty-four hour local hold and a forty-eight hour upcountry hold, and Terms §7 "
        "allows wrong, damaged, or not-as-described claims for forty-eight hours either way. "
        "Those windows stack; they do not cancel each other. A photo in the short window "
        "is the fastest freeze. A HELP SKN-1002 in the longer window still matters even if "
        "auto-release already fired — support settles it by hand. Nobody should be told they "
        "are too late if they are inside forty-eight hours."
    )
    p(
        "Upcountry courier: there is no rider OTP. The buyer replies YES SKN-1002 after the "
        "parcel is in their hands and they are happy. Collection from a pickup point is "
        "similar in spirit: the parcel is already paid, the shop releases it when Sokoni "
        "says so, and the buyer should still inspect. Risk, per terms, passes on successful "
        "delivery to the address or collection from an authorised pickup point."
    )
    h2("After")
    p(
        "A delivered order can be rated. RATE 5 or a number from one to five. When both a "
        "rider and a seller were on the job, the bot can ask for both. Reviews can show on "
        "the shop and on the site. If something was wrong and they already opened HELP, they "
        "should not also YES. Escrow stays held until a person looks. Liability on a given "
        "order is capped at what they prepaid for that order. That is the terms. It is also "
        "why paying into escrow is a stronger position than cash: there is a defined amount "
        "sitting in a defined place with a defined SKN."
    )

    # ------------------------------------------------------------------
    h1("10. Checkout, M-Pesa, and what the buyer pays")
    p(
        "Checkout is the moment the listed price becomes an obligation. On WhatsApp it is "
        "mostly messages and an STK. On the website it is checkout.html. The page resolves "
        "GET /api/checkout/{orderId}, reads readiness, lists landmarks, lists counties, "
        "calculates shipping, applies shipping to the order, then posts STK. Hybrid delivery "
        "selection is the Phase 15 work: a county dropdown covering Kenya's forty-seven "
        "counties and tiers, or a map pin that can hit vendor GeoJSON zones. Shipping is "
        "applied before STK so the prompt amount is the real total, not an IOU."
    )
    p(
        "What the buyer sees in the total is the item (or items), seller shipping when this "
        "is an upcountry seller-arranged job, the platform's distance fee when this is a "
        "local Sokoni rider job, and a banded M-Pesa transaction fee on the order total. "
        "Nothing extra is collected at the door. Terms say Sokoni does not charge hidden "
        "commitment fees, registration fees, or delivery deposits on top of the listed price. "
        "Promotional discounts on eligible orders are capped at three percent unless something "
        "else is stated in writing."
    )
    p(
        "STK success is a callback, not a screenshot. When the payment rail is live, a "
        "successful result confirms the order, locks stock, can generate the drop-off label, "
        "and notifies buyer and seller. Manual paid is the fallback when the buyer used the "
        "till shown on checkout. Plug has a verify_payment_code tool so a pasted receipt "
        "can be matched to recorded webhooks instead of believed on vibes. Plug still must "
        "not invent a till. Only the prompt or the till shown at checkout is a Sokoni payment."
    )
    p(
        "COD objections get a specific shape of answer, because they are common and because "
        "the wrong answer would destroy the model. Acknowledge the worry. Say the money is "
        "held by Sokoni, not sent to the seller. Say they inspect before they release — OTP "
        "locally, YES upcountry. Say a wrong or fake item reported in the window is a refund "
        "path. Then offer the next step. Warm, not defensive. Never 'let me check if we can "
        "do cash this once'."
    )
    p(
        "Fraud and prank-order habits sit on the ops side: bad addresses, repeat abandonments, "
        "and spam can hold dispatch. Buyers who pay real money should not be punished for "
        "that. Sellers should not be sent on wild goose chases. The prepaid model exists "
        "partly so a joke order costs the joker, not the shop and the rider."
    )

    # ------------------------------------------------------------------
    h1("11. Escrow, inspection, refunds, and disputes")
    p(
        "Escrow is the product. Everything else is how parcels move around it. When a buyer "
        "pays, the money is not the seller's. It is Sokoni's hold against a specific SKN. "
        "The seller can see that an order is paid and that they should pack. They cannot "
        "see the money in their M-Pesa yet. That delay is the protection the About page "
        "promises: your money is held until the item arrives as described."
    )
    p(
        "The cycle is pay, hold, dispatch, inspect, confirm, release. Pay is STK or the "
        "documented till fallback. Hold starts immediately. Dispatch is the seller's clock. "
        "If they have not dispatched within twelve hours of payment, the order is refunded "
        "and the seller is not paid. When the payout rail to the buyer is up, the refund "
        "goes to the number that paid. When it is not, the refund is queued for a person, "
        "and the seller still is not paid. That is the trust page, not a slogan."
    )
    p(
        "Inspection is several overlapping clocks because different failures look different. "
        "Trust-and-safety describes two hours after a parcel is marked delivered: send a "
        "photo of the problem, and the payout stays frozen once that photo is saved. Support "
        "is asked to decide only after the photo is in. Without a photo, that particular "
        "freeze does not fire. Knowledge for Plug describes twenty-four hours from local "
        "rider delivery and forty-eight hours from upcountry courier delivery, stored per "
        "order as autoReleaseHours, which Plug should quote when a lookup returns it. Local "
        "rider fees also sit in a fifteen-minute hold after CONFIRM before the rider is paid, "
        "which is why a rider who asks 'nimeconfirm sasa hii pesa' at minute five is told "
        "to wait. Terms §7 says wrong, defective, or not-as-described items should be raised "
        "on WhatsApp within forty-eight hours of delivery. Eligible prepaid orders may "
        "qualify for refund or replacement from escrow, at Sokoni's discretion on evidence. "
        "If auto-release already happened, the forty-eight hour claim is still valid and is "
        "settled manually. Plug is told never to say the buyer is too late."
    )
    p(
        "Confirmation is how a happy path releases. Local rider: Delivery OTP plus GPS "
        "within about two hundred metres of the buyer's pin. Upcountry: YES SKN-####. "
        "Seller payout after confirmed delivery is typically two to three business days "
        "after delivery status in the terms, while seller-hub language also allows Ready "
        "for M-Pesa sooner when the hold days are configured to zero. Riders do not wait "
        "on a withdraw button; their fee sweeps on its own after the short hold."
    )
    p(
        "A dispute is HELP SKN-####, DISPUTE SKN-####, or a clear 'this arrived damaged' "
        "that the bot can recognise. Opening it freezes seller payout. The bot asks for "
        "photos. Missing packages use the same family of commands. If a parcel is marked "
        "delivered and the buyer never received it, HELP keeps escrow held. Sokoni does "
        "not pay the seller for a parcel the buyer did not get. Plug opens tickets. Admins "
        "resolve them. Plug must never quote a refund amount, never release escrow, and "
        "never promise a payout date. A seller who needs to make a customer whole without "
        "a full fight has PARTIAL_REFUND SKN-#### amount, inside rules, as a command, not "
        "as a chatty AI money move."
    )
    p(
        "Goodwill is separate from escrow release. Plug may propose a bounded voucher through "
        "propose_goodwill. The cap is enforced in code. Automated customer promos are capped "
        "at three percent with code SOKONI3. That is operations policy as well as marketing. "
        "It stops the assistant from giving away the shop to end a tense thread."
    )
    note(
        "The money rule for every agent",
        "Language models do not move M-Pesa. Command handlers, payment callbacks, and "
        "staff-approved admin paths do. Shadow advisors that sit beside the primary stack "
        "are not allowed to auto-release escrow or pin riders. If a conversation is about "
        "money, the next honest sentence is a command, a SKN, or a human, not a creative total.",
    )

    # ------------------------------------------------------------------
    h1("12. Tracking, labels, and shipment status")
    p(
        "Tracking is the public face of logistics. After payment the shipment can sit at "
        "label_ready: the prepaid QR exists, the seller can print. Dropped_off means the "
        "seller or a hub scan says the parcel is in the network. In_transit means a courier "
        "or a rider has it. At_pickup_point means a shop is holding it for collection. "
        "Delivered is the status that lets escrow think about release. Those words are "
        "what track.html draws as a stepper. The API is GET /api/tracking/{id} for the "
        "timeline and GET /api/tracking/{id}/rider when a live point is available. The "
        "payload is sanitised. It is not a dump of payment credentials."
    )
    p(
        "On WhatsApp, pasting SKN-1002, SKN-1002-1, or an older SK-1042, or typing track "
        "or status, should return the same story in sentences. Rider contact is included "
        "once a rider has accepted, not before, so buyers are not calling a pool. Hubs "
        "advance with staff scan tools. Courier names in the adapter layer are things like "
        "Fargo, Pickup Mtaani, Sendy, G4S — manual first, live APIs later — so the order "
        "flow does not care which van actually rolled."
    )
    p(
        "The label is a physical object. label.html?order=SKN-1002-1 prints what a hub can "
        "scan. Sellers see Print label after pay. The assistant may only quote that label "
        "URL pattern when a lookup actually returned it. Inventing /qr?order= or splitting "
        "a SKN across lines breaks both the link and the parcel. For riders, scan.html is "
        "a helper: read the code, then still type PICKUP SKN-#### #### with the seller's "
        "OTP, because custody is a command, not a camera."
    )
    p(
        "Delivery times on the terms are estimates, typically one to five days depending "
        "on location. Honest copy prefers that range over a fake same-day guarantee. Local "
        "rider jobs in the metro can be much faster than a sacco to a far county. Upcountry "
        "is the seller's courier reality. Plug should not invent an ETA it did not look up."
    )

    # ------------------------------------------------------------------
    h1("13. Sellers — from first listing to payout")
    p(
        "A seller on Sokoni is a person with goods in Kenya and a WhatsApp number. They "
        "might be a thrift stall, a boutique, or someone clearing a closet. Launch copy "
        "says zero listing fees. Listings may go live instantly and then face moderation. "
        "Counterfeit, stolen, and prohibited goods are banned. Shops can be paused. Accuracy "
        "of photos, size, colour, and stock is a vendor term, not a nice-to-have, because "
        "overselling is how escrow fights start."
    )
    h2("Opening the shop")
    p(
        "The fastest path is WhatsApp. They reply SELL. Chat collects shop name, handle, "
        "payout M-Pesa number, and a pickup pin. The pin is required. It is where riders "
        "come, and it is one end of every local delivery price from that shop. Without it "
        "the shop is not created. On a phone that will not share location, Seller Hub has "
        "a map they can tap. Stand where the parcel will be handed over, then Attach, "
        "Location, Send your current location. Sellers who joined before pins existed still "
        "function, but every local delivery from them prices at the KES 400 minimum until "
        "they add one. If they ask why Nairobi is always four hundred, that is why."
    )
    p(
        "The web path is sokonimall.com/suppliers/list.html. Enter WhatsApp number, send "
        "code, enter the six-digit code, create shop name and optional @handle, optionally "
        "add National ID for vetting. Listing can start without ID; vetting still helps. "
        "Payouts are configured under Settings: M-Pesa number and, if they use them, till "
        "or paybill details for receiving from Sokoni, never for charging buyers. Buyers "
        "must not pay the seller's personal till. Approvals for payout verification are "
        "usually hours on business days, not a promise of minutes."
    )
    h2("First order")
    p(
        "When a buyer pays, the seller is notified. They were not notified at add-to-bag, "
        "on purpose, so unpaid windows do not create fake urgency. They pack the item as "
        "photographed. For a local rider job they wait. Sokoni pins the rider. The seller "
        "does not choose from a list. When the rider arrives, the seller speaks the four-digit "
        "Pickup OTP. The rider types PICKUP SKN-1002 4821. Only then does custody move. "
        "Handing a parcel to someone who 'knows the order number' without the OTP is how "
        "parcels vanish. For upcountry, the seller ships themselves. They reply DISPATCH "
        "SKN-1002, then WAYBILL SKN-1002 Courier Tracking, and they send two photos before "
        "the box is lost in a sacco: the packed parcel with the waybill, and the item before "
        "sealing. Those photos are the evidence if the buyer says the box arrived empty."
    )
    p(
        "They can print the prepaid label and drop at a hub instead of waiting at the shop. "
        "Hub scan then becomes dropped_off on the buyer's tracker. Dispatch notes belong "
        "to the seller. Updating tracking so the buyer sees progress is part of vendor terms. "
        "Catalog edits belong in Seller Hub, not in a free-text argument with Plug. Plug "
        "can explain the hub; it should not guess a new price into the database from a "
        "chatty 'weka 1500'."
    )
    h2("Getting paid")
    p(
        "After the buyer confirms, or after the inspection window closes with no dispute, "
        "seller net is scheduled. Terms say typically two to three business days after "
        "delivery status. The wallet shows Ready. On WhatsApp they can type balance and "
        "WITHDRAW. On the Hub they use Payouts. Instant transfer exists when the payout "
        "rail is enabled; otherwise the request queues for staff. Item-level percent promos "
        "lower the live STK price for that SKU only. They are not cart-wide coupons. Low "
        "stock at two units or fewer can WhatsApp the seller. A shop promo banner on the "
        "public shop page is marketing copy; it does not cut the price unless an item promo "
        "is actually set."
    )
    p(
        "Shipping rates on the Hub are for upcountry. Local metro rider fees are platform "
        "prices. A seller who insists they charge two hundred for Nairobi is talking about "
        "a courier tariff that does not apply to Sokoni boda jobs. Mixing those two sentences "
        "in front of a buyer is the most common support mistake this handbook exists to stop."
    )

    # ------------------------------------------------------------------
    h1("14. Listing quality, stock, photos, and promos")
    p(
        "A listing is a promise in photos. The Hub wizard asks for photos, a title, the "
        "price the seller wants to receive, condition, and stock. One to four photos is "
        "the public sell story. Cover photo can go through vision: models look at the image "
        "and draft title and details, then the seller edits. Fallbacks exist if one vision "
        "provider is down. The draft is not allowed to invent a luxury brand that is not "
        "in the picture. Acceptable-use checking (check_aup) is a tool so prohibited items "
        "can be caught before they become a BRS problem."
    )
    p(
        "Media studio work is background cleanup and a short clip so a grid card does not "
        "look like a bedroom selfie if the seller does not want that. Cloudinary is the "
        "primary pipeline. A Remotion worker on the VM is a fallback so rendering a clip "
        "cannot crash the shop process. Optional other clip providers sit in front of that "
        "fallback. Failures should leave a still image, not a dead listing."
    )
    p(
        "Stock is units or size and colour variants. Overselling is how a paid SKN becomes "
        "a dispute. Variants exist so a shop can sell multiple sizes without lying. Bulk "
        "upload is for people with a real catalog, CSV or JSON, still moderated after publish. "
        "Categories should be real aisles from the browse tree so WhatsApp and the website "
        "can find the item. A linen dress dumped in Electronics will not be found by the "
        "buyer who typed 'linen'."
    )
    p(
        "Promos: per listing percent. SOKONI3 is a platform code with a three percent cap. "
        "Sellers who want a real markdown set it on the item. Shop-wide 'everything must "
        "go' in automated WhatsApp is not the mechanism. Offers from buyers are a different "
        "path: negotiate, accept, then still checkout through escrow. An accepted offer "
        "that then asks for cash to a personal number is a policy violation, not a clever close."
    )

    # ------------------------------------------------------------------
    h1("15. Riders — joining, jobs, OTPs, and earnings")
    p(
        "Sokoni riders are boda operators who carry prepaid parcels in the local metro. "
        "They are not collecting cash. They are not browsing a public job board. Sokoni "
        "offers a job to a rider based on availability, distance, and score. The rider "
        "accepts or declines that offer. Applications are currently framed for Nairobi or "
        "Thika. The phone must be Kenyan because payouts are M-Pesa. A foreign number fails "
        "at the phone step on purpose."
    )
    h2("Applying")
    p(
        "WhatsApp is first. RIDER APPLY, or ride, rider, boda, starts a chat form. Most "
        "riders have WhatsApp and may not have data for a long web form. The web form is "
        "sokonimall.com/boda/apply.html, the same queue. Required: full name, WhatsApp and "
        "M-Pesa phone (same number for jobs and payouts), National ID number, operating town, "
        "base stage, motorbike plate, National ID front photo, valid Class A licence, stage "
        "chairman recommendation letter. Optional but useful: ID back, logbook or power of "
        "attorney, Good Conduct, NTSA badge. A stage map pin is optional. Offers prefer "
        "riders nearest pickup, so a pin means more nearby work. Without one, matching falls "
        "back to live location or stage name. Status goes PENDING, then VERIFIED or REJECTED "
        "with a reason. Ops usually answers on WhatsApp within about a day. Plug must not "
        "promise approval, earnings, or a faster review."
    )
    h2("A working day")
    p(
        "The rider sets AVAILABLE and shares WhatsApp Live Location. No separate GPS app "
        "is required for the MVP answers. A job offer arrives for SKN-1002. They type "
        "ACCEPT SKN-1002. The claim is atomic; only the offered rider wins. They ride to "
        "the seller pin. The seller speaks a four-digit Pickup OTP. The rider types "
        "PICKUP SKN-1002 4821. They ride to the buyer. The buyer inspects. If the buyer "
        "is happy they speak the Delivery OTP. The rider types CONFIRM SKN-1002 7391 and "
        "must be within about two hundred metres of the buyer's pin. CONFIRM without GPS "
        "is not a complete delivery. OTP alone can be read on a phone call from the stage. "
        "GPS is the proof they stood at the gate. Every attempt records distance, which "
        "is evidence if someone later says the parcel was confirmed from town."
    )
    p(
        "If the message is 'Drop-off GPS is not on file', that is not the rider's missing "
        "location. It is the buyer's pin missing on the order. Resending rider GPS will "
        "not fix it. Ops has to set the drop-off. DECLINE, NO_SHOW, and VERIFY_RETURN exist "
        "for refused jobs, empty houses, and returns. Penalties and details belong to ops, "
        "not to Plug inventing a fine. OFFLINE stops offers."
    )
    h2("Earnings")
    p(
        "There is no rider withdraw command. After CONFIRM the fee sits fifteen minutes "
        "for the buyer to shout. Then a sweep about every thirty minutes sends M-Pesa to "
        "the registered number. Under forty-five minutes since CONFIRM is normal. Amounts "
        "under KES 200 wait and batch. KES 5,000 per rider per day is the cap; overflow "
        "rolls to the next day. A single fee above KES 1,500 is held for an ops check. "
        "Failed sends retry with growing gaps. If a rider says they have not been paid, "
        "Plug must not quote a balance, promise a date, or claim a payment was sent unless "
        "a lookup in front of it says so. The honest line is that Sokoni will check. Staff "
        "can release a hold, pay directly, or run a sweep from their desk. Riders cannot "
        "request those buttons, so do not tell them to."
    )
    p(
        "On a KES 400 local delivery the platform takes ten percent, M-Pesa takes its B2C "
        "charge, and the rider nets KES 345 in the documented example. The buyer paid that "
        "fee into escrow with the item. Paying the rider extra at the gate is not a Sokoni "
        "order. Asking the buyer for fuel because 'escrow is slow' is a red flag."
    )

    # ------------------------------------------------------------------
    h1("16. Pickup point partners")
    p(
        "A pickup point is a real shop — phone shop, duka, cyber, salon — that agrees to "
        "receive already-paid Sokoni parcels and hand them to the right person. It is how "
        "countrywide collection works without sending a boda to every village gate. The "
        "marketing page is pickup-points.html. Apply on the site or through pickup menu on "
        "WhatsApp. Sokoni reviews location and storage, commonly within forty-eight hours "
        "on the marketing copy, and may approve, reject, suspend, or remove at discretion."
    )
    p(
        "Once live, a rider or courier drops the parcel. The shop stores it securely. The "
        "customer collects within five days unless a different hold is agreed. Release "
        "happens only after Sokoni confirms payment and sends a release notice. Parcels "
        "are prepaid; this is not cash on collection. Customer name, phone, and SKN are "
        "confidential and used only to verify who is collecting. Commission is described "
        "as KES 50 plus per parcel received and released, exact rate on approval, M-Pesa "
        "weekly for verified points. Extra foot traffic is a real side effect: people who "
        "collect may buy airtime or a drink. It is not guaranteed revenue."
    )
    p(
        "Approved partners may appear on the website with shop name, area, and hours. "
        "Applicants are contacted on WhatsApp for operational updates. Treating the programme "
        "as a place to open boxes and resell the contents is not the programme."
    )

    # ------------------------------------------------------------------
    h1("17. Logistics and delivery pricing")
    p(
        "Two different products are both called delivery, and mixing them is the usual "
        "way a seller and a buyer end up shouting. Local metro rider delivery is Sokoni's. "
        "Upcountry courier is the seller's. Pickup points are a third ending, not a third "
        "price formula."
    )
    h2("Local metro rider")
    p(
        "Both ends inside the Nairobi metro — Nairobi, Kiambu, and Machakos metro towns "
        "such as Syokimau, Athi River, Kitengela, and similar — can be a Sokoni boda job "
        "after prepaid payment. Sokoni pins the rider. The seller's own Hub rates do not "
        "apply. The fee is distance between seller pickup pin and buyer pin. Straight-line "
        "distance is multiplied by 1.3 because bikes follow roads. The published formula "
        "is KES 400 minimum covering the first five road kilometres, then KES 25 per road "
        "kilometre, with a KES 1,500 ceiling however far. If either pin is missing the fee "
        "falls back to KES 400 rather than blocking checkout. That fallback is usually a "
        "seller who has not set a pickup pin, and the fix is to set one, not to argue the fee."
    )
    p(
        "Nobody should quote a specific-order delivery figure in conversation. It depends "
        "on two pins. Checkout shows the exact amount before STK. Plug is forbidden from "
        "estimating, and forbidden from reusing a number from an old order. Currency is "
        "always KES."
    )
    h2("Upcountry courier")
    p(
        "Anywhere outside the metro, no Sokoni rider is involved in the MVP. The seller "
        "ships by courier or parcel sacco, registers WAYBILL, and sends the two photos. "
        "Their Seller Hub county tiers set the price. Kenya's forty-seven counties are in "
        "the checkout dropdown. Sellers without a shipping profile currently contribute "
        "KES 0 shipping in that engine, which matches an older 'seller arranges delivery' "
        "habit and must be explained honestly at checkout rather than surprised later. "
        "Inspection after upcountry delivery is the longer forty-eight hour window."
    )
    h2("Pins")
    p(
        "A pin is a coordinate, not a postal sentence. Seller pins are required for new "
        "shops. Rider stage pins are optional. Buyer pins are per order and strongly preferred. "
        "Refused pins: 0,0, swapped lat/long, outside Kenya. WhatsApp method: paperclip, "
        "Location, Send your current location, standing where the pin should be. Hub drop-off "
        "and home delivery can combine: seller to hub with a label, hub toward buyer by "
        "rider or courier, then door or pickup shop. Contact details are shared with sellers, "
        "riders, or pickup partners only when needed for fulfillment."
    )

    # ------------------------------------------------------------------
    h1("18. Multi-seller carts")
    p(
        "A fashion shopper does not buy the whole look from one stall. The bag on the "
        "website is allowed to hold lines from more than one seller. The money path still "
        "looks like one M-Pesa prompt, because asking someone to STK three times for one "
        "outfit is how you lose the sale. The design, accepted in August 2026, is a parent "
        "SKN for the cart and child SKNs per line."
    )
    p(
        "Parent and single-item orders share the same SKN sequence, so SKN-1002 might be "
        "a single dress or the parent of a dress and sneakers. Children are SKN-1002-1, "
        "SKN-1002-2, one-based, one child per line. Legacy SK-#### remains readable on "
        "track and in chat. Platform commission is computed per child, because each shop "
        "has its own net. The M-Pesa transaction fee is charged once on the parent total, "
        "so the buyer is not punished per line. Persistence was designed to extend the "
        "file-backed order book first. Sellers are notified only after the paid webhook, "
        "never when a browser merely saved a bag. Refunds of a child are a staff path first. "
        "Escrow release and payout run on the child that actually delivered, so one late "
        "sneaker does not freeze a dress that already arrived."
    )
    p(
        "Tracking accepts parent or child. The track page should explain a mixed bag without "
        "pretending it is one box. WhatsApp photos of each line still matter so a seller "
        "packs the right SKU. Address capture is once, on the parent, then inherited, with "
        "pins copied so rider math still works per dispatch."
    )

    # ------------------------------------------------------------------
    h1("19. AI: Sokoni Plug, specialists, and tools")
    p(
        "Sokoni Plug is the shopper-facing assistant on WhatsApp and on ask.html. It is "
        "not the only agent in the repository, and it is not allowed to be the cashier. "
        "The four tiers are command router, system prompt, dynamic user context, and "
        "knowledge RAG, with tools executed on the server before the model writes a word. "
        "Native model tool_calls are disabled for Plug on purpose. Lookups already ran. "
        "The model replies in plain language from LOOKUP RESULTS and CONTEXT. If those are "
        "empty, it says it does not have the exact details and can escalate. It does not "
        "invent SKN-1004 perfume oils to look busy."
    )
    h2("Identity and tone")
    p(
        "The system prompt names it Sokoni Bot, the official multi-agent AI for Sokoni Mall "
        "Kenya. Scope is this marketplace only. Light small talk is fine. Weather, politics, "
        "and homework get a brief redirect. Grounding is strict: no fabricated policies, "
        "stocks, prices, balances, or features. Sellers are identified by the WhatsApp phone "
        "in lookup results; Plug should not demand an @handle to list sales when the seller "
        "tools already ran. Safety: never ask for PIN or card, never invent tills. High anger, "
        "legal action, or fraud claims acknowledge and note that support will follow. WhatsApp "
        "formatting is part of the product: bold SKN and KES, no asterisks around URLs, blank "
        "lines between ideas, numbered steps on their own lines, almost no emoji stacks."
    )
    h2("Specialist lanes")
    p(
        "Before the reply, a graph routes the turn into a specialist: buyer, seller, dispute, "
        "logistics, or general. Each lane has an allowlist of tools. A buyer lane can search, "
        "browse, get a product, track, list that buyer's orders, open a return case, create "
        "a checkout link, verify a payment code, and fetch store_info. It cannot update another "
        "shop's inventory. A seller lane can onboard, snapshot payout, list that shop's orders "
        "and listings, look up who sold an order, read shipping rates, update inventory, "
        "dispatch_with_rider, and check acceptable use. A dispute lane can track, open a "
        "return case, and propose goodwill, not release escrow. Logistics can track, label, "
        "rates, and dispatch notify. General gets the full Plug tool list when routing is unsure."
    )
    h2("What each Plug tool is for")
    p(
        "search_products is keyword search with budget and condition filters. browse_products "
        "lists live items on a browse path. browse_taxonomy returns the aisle tree so Plug "
        "can answer 'what categories do you have' without hallucinating a mall. get_product "
        "is a single listing. track_order is shipment status. get_order_label is the printable "
        "URL when it exists. list_orders is that buyer's orders for a phone. list_seller_orders "
        "and list_seller_listings are the shop's world. lookup_order_seller answers who sold "
        "an SKN. store_info is policies, contacts, how-it-works, promo, site URLs — the "
        "grounded FAQ. open_return_case starts a dispute record. get_seller_onboarding and "
        "get_rider_onboarding return the real steps, including the apply URLs. get_seller_payout "
        "is a ledger snapshot, not a promise. get_shipping_rates is the seller matrix. "
        "propose_goodwill is a capped voucher proposal. create_checkout_link reserves and "
        "points at STK. update_inventory changes stock or price for an authenticated seller. "
        "dispatch_with_rider marks dispatch and notifies. verify_payment_code matches a "
        "receipt to webhooks. check_aup tests prohibited content."
    )
    p(
        "Chat models sit behind a backend router. The documented path prefers a fast primary, "
        "then OpenRouter, with optional Gemini. Temperature is low. Failures should still "
        "leave menus and commands working. Catalog vision for listings is a different stack "
        "again: vision models with fallbacks, not the shopper chat model pretending to see."
    )
    h2("What Plug must refuse")
    p(
        "It does not ACCEPT a job, type an OTP, FORCE RELEASE, pin a rider, or work out a "
        "delivery fee. If a human tries those in freeform, it replies with the exact command "
        "shape, using KES. It does not send people back to wa.me on the same number. It does "
        "not tell a rider there is a withdraw button. It does not tell a seller to skip the "
        "pickup pin. It does not search overseas marketplaces. Live catalog only."
    )

    # ------------------------------------------------------------------
    h1("20. Background agents, ops, media, and voice")
    p(
        "Behind Plug is a fabric of listeners. They subscribe to events such as offers, "
        "STK prompts, inspection windows, and completed deliveries. Level 1 is a rate-limited "
        "nudge and a report. Example: a buyer with a real history offers close to list, "
        "within a bounded percentage, and the seller gets one WhatsApp line to accept or "
        "decline in the Hub. Level 2 money movement is not started from those listeners. "
        "A proposal has to be approved on an admin route that already owns payout and checkout. "
        "That split is how you get helpful automation without a runaway refund loop."
    )
    p(
        "Inspection-window watchers fire auto-release when the clock says so and no dispute "
        "is open. Review nudges ask for RATE after a completed job. Chat-control and flagged "
        "stores keep abuse signals. An actions queue is visible on the ops desk so a human "
        "can see what the fabric wanted to do. Output guards and heap guards keep a bad "
        "reply or a memory spike from taking down WhatsApp for everyone."
    )
    p(
        "The ops agent is a different creature. It is a tool-calling assistant for staff "
        "on the command desk. It can read inquiry metrics, order metrics, a platform snapshot, "
        "pending escrow, open disputes, seller and rider rosters, CRM contacts, catalog "
        "search, policy search, escrow status, order history. It can, through named functions "
        "with validated arguments, create an STK, confirm dispatch, submit inspection photos, "
        "release a payout, raise a dispute, trigger the twelve-hour dispatch refund, schedule "
        "a reminder, send WhatsApp messages or voice, tag CRM, and escalate to a human. It "
        "does not get raw SQL. It is not Plug. Shoppers never speak to it."
    )
    p(
        "Staff also have an executive layer: roles such as super admin, dispute manager, "
        "logistics lead, and support agent. Briefings can go out in the morning. Dispute "
        "alerts can arrive as numbered cards: refund buyer, release to seller, split, or "
        "open the portal. Voice notes from staff can be transcribed into those commands. "
        "Shopper Plug cannot use that palette even if a buyer types similar English."
    )
    p(
        "MAS, the multi-agent system, is a shadow layer. Primaries stay Cloudinary then "
        "other clip providers then Remotion for video, and the chat router for talk. MAS "
        "can run security heuristics, logistics advice, OCR, and last-resort media in "
        "parallel. Shadow by default means it logs and learns without grabbing the wheel. "
        "Transactional shadow is documented as never auto-releasing escrow. Health reports "
        "whether MAS is on and whether primaries are untouched."
    )
    p(
        "TikTok posting, when enabled, is for in-stock store products, with captions drafted "
        "by AI, and a sync into the site's featured JSON. Private WhatsApp threads are not "
        "content. Inbound voice is speech-to-text into the same router. Outbound TTS is "
        "optional. A floating website microphone was removed on the voice roadmap; WhatsApp "
        "and ask.html remain."
    )

    # ------------------------------------------------------------------
    h1("21. About, FAQ, trust, terms, and privacy")
    p(
        "This chapter restates the public legal and trust pages in one place. Dates below "
        "are the ones on those pages at the time of writing: terms and privacy last updated "
        "27 July 2026. About and trust carry the BRS identity that customers can verify "
        "without trusting a PDF."
    )
    h2("About")
    p(
        "Sokoni Mall Enterprise is a Kenyan peer-to-peer marketplace for brand-new merchandise "
        "and pre-loved fashion. It combines a Depop-style storefront with a smart WhatsApp "
        "assistant so people can browse, pay upfront, and track every order without another "
        "app. Mission: trusted local commerce as easy as texting a friend, in English, "
        "Kiswahili, and Sheng, matching buyers to real listings across Kenya, holding every "
        "payment until delivery is confirmed."
    )
    p(
        "How it works on that page: shop on the website or chat with Plug; pay upfront, "
        "one hundred percent prepaid via M-Pesa STK, no cash on delivery; escrow protection "
        "until the item arrives as described; track with SKN-#### on track.html or WhatsApp. "
        "Anyone can list at /suppliers/list, upload photos, add details, post live. Sellers "
        "drop off at a hub using a prepaid label; payouts release after confirmed delivery; "
        "zero listing fees during launch. Transparency: always verify the SKN on +254 117 "
        "422 428 before paying; never send money to riders or personal numbers. Contact: "
        "that WhatsApp, support@sokonimall.com, Kenya countrywide. Official registration "
        "table: SKN MALL KENYA, BN-36SM2YW9, Cap. 499 Sec. 14, BRS, Murang'a Union Building "
        "address, 4 September 2026. Verify by SMS BRS to 21546 and the registration number."
    )
    h2("FAQ")
    p(
        "What is Sokoni Mall? Kenya's prepaid marketplace for brand-new and pre-loved fashion "
        "and lifestyle. Shop on the website or WhatsApp, pay upfront, track with SKN-####, "
        "escrow until delivery. How does WhatsApp shopping work? No extra app required. "
        "Message Plug on +254 117 422 428 in English, Kiswahili, or Sheng, search the local "
        "catalog, prepaid order, M-Pesa, track in the same chat."
    )
    p(
        "Do you accept cash on delivery? No, deliberately. Paying into escrow is safer than "
        "handing cash to a rider: the money sits with Sokoni, not the seller, until the "
        "parcel is in hand and the buyer is happy. Cash handovers leave no record. How do "
        "I pay? After ordering you get SKN-####, pay via STK, reply paid if a confirmation "
        "code needs verifying. Which M-Pesa should I pay? The STK prompt from WhatsApp or "
        "checkout, never personal numbers or riders, always verify the SKN first."
    )
    p(
        "What is escrow protection? Payment held by Sokoni, never released to the seller, "
        "until delivered and confirmed. Inspect before sharing the delivery code. Report "
        "damage or wrong items as soon as they arrive. Holds: twenty-four hours after local "
        "rider delivery, forty-eight after upcountry courier. Claims up to forty-eight hours "
        "either way under Terms §7; after escrow has cleared, refunds are settled manually. "
        "How do I track? SKN-1002, lines SKN-1002-1, older SK-#### still work, track.html "
        "or type the number in WhatsApp, timeline label to delivered."
    )
    p(
        "International items? No. Local Kenya inventory only. How to sell? suppliers/list, "
        "photos, title, price, condition, post, moderation, hub drop-off, payout after "
        "delivery. Offers? SOKONI3 up to three percent in beta; no deposits or extra fees "
        "on top of listed price. Is it safe? STK into escrow, seller paid after delivery, "
        "inspection photo freezes payout, full story on trust-and-safety. If the seller has "
        "not dispatched in twelve hours you are refunded. HELP plus the order number if a "
        "parcel never arrives. Is it a scam? No. SKN MALL KENYA, BN-36SM2YW9, SMS BRS to "
        "21546, phone and email as above. Support: WhatsApp and calls, email, Talk to a "
        "Human 7:30 AM to 9 PM EAT, AI on ask.html or WhatsApp anytime."
    )
    h2("Trust and safety")
    p(
        "The page title is the question people actually type: is Sokoni Mall legit? Yes. "
        "Trade name of SKN MALL KENYA, BN-36SM2YW9. You pay STK before the parcel moves. "
        "Money stays in escrow until delivery. Countrywide. The registered office is a BRS "
        "record, not a service-area limit. Checkout sends STK tied to SKN-####, not to a "
        "seller, rider, or personal number. Seller is paid after delivery is confirmed. A "
        "local dispatch can auto-release twenty-four hours later if you have not replied "
        "YES and there is no dispute; upcountry waits forty-eight. A dispute or a photo "
        "during inspection stops that release."
    )
    p(
        "Two-hour inspection: after marked delivered, look at it, send a photo if wrong, "
        "payout frozen once the photo is saved. Support decides after the photo is in. "
        "Without a photo that freeze does not run. Forty-eight hour claims still exist. "
        "If not delivered: twelve-hour no-dispatch refund; if marked delivered but never "
        "received, HELP and the order number, escrow stays held, seller is not paid for a "
        "ghost parcel. Registration check repeats the SMS path. Talk to a person uses the "
        "same phone and email. Order status does not need a person."
    )
    h2("Terms of Service")
    p(
        "By using Sokoni you agree to these terms. The platform is a growing Kenyan business "
        "in a founder-led launch phase. Catalog, assistant, escrow, and logistics are "
        "operational and improving. Sokoni is a trade name operated from Kenya, one hundred "
        "percent prepaid, no COD for catalog orders. Buyers pay the full listed price before "
        "dispatch. Funds are held in escrow until delivery is confirmed. Sellers receive "
        "payout after confirmed delivery, typically two to three business days after delivery "
        "status. No hidden commitment, registration, or delivery-deposit fees on top of the "
        "listed price. Promotional discounts capped at three percent unless written otherwise."
    )
    p(
        "Services listed: website browse, search, save, track; WhatsApp assistant to search, "
        "order, pay, track; seller listings at suppliers/list; SKN tracking; pickup point "
        "programme; social posts of product highlights. Features may change. Stock is not "
        "guaranteed. Orders and payment: STK with SKN, never riders or personal numbers, "
        "reply paid after manual till payment, accurate name location and phone, refuse or "
        "cancel suspected fraud or unavailable stock, local Kenya inventory only. Delivery: "
        "estimates typically one to five days, hub labels, timeline, contact shared only "
        "as needed, risk passes on successful delivery or authorised pickup collection."
    )
    p(
        "Returns: WhatsApp within forty-eight hours of delivery for wrong, defective, or "
        "not-as-described; refund or replacement from escrow at Sokoni's discretion on "
        "evidence. Acceptable use: no misuse, no prohibited or counterfeit goods, no spam, "
        "no impersonation, no attempts on admin systems, no unlawful use; Sokoni may suspend, "
        "remove listings, or withhold payouts. AI may be inaccurate; confirm price, condition, "
        "and suitability before ordering; Sokoni is not liable for decisions made solely on "
        "AI text. Liability: to the fullest extent of Kenyan law, not for indirect or "
        "consequential damages or third-party failures (couriers, payment networks, WhatsApp, "
        "sellers); total liability for a claim on an order limited to the prepaid escrow "
        "amount paid for that order. Terms may update; continued use is acceptance."
    )
    p(
        "Seller listings section: you set the price; buyers pay one hundred percent upfront; "
        "escrow until delivery; instant live possible; post-publish moderation; payout after "
        "confirmed delivery; drop off at a hub with the SKN label; accurate, legally sellable "
        "goods that match photos; counterfeit, stolen, prohibited banned; listing means you "
        "agree to terms and privacy. Pickup point section: physical shop, secure storage, "
        "regular hours; hold up to five days; commission per parcel confirmed on approval; "
        "M-Pesa on an agreed cycle; release only after Sokoni confirmation; customer data "
        "confidential; Sokoni may approve or remove; applying means you agree to terms and "
        "privacy. Contact block matches About."
    )
    h2("Privacy Policy")
    p(
        "Sokoni Mall Enterprise respects privacy. The policy covers the website, WhatsApp, "
        "seller listings, and pickup applications. Collected: WhatsApp messages needed to "
        "fulfil (order details, names, addresses, phones); order data including SKN, shipment "
        "and escrow status, M-Pesa confirmations; STK callbacks (amount, receipt, phone) and "
        "manual paid claims; reviews; seller listing photos, titles, descriptions, prices, "
        "tags, condition, seller contact submitted at the Hub; anonymous feed events; pickup "
        "applications (shop name, contact, location, hours, M-Pesa details if applied); "
        "website usage such as browser type, pages, localStorage preferences; technical logs "
        "such as IP, timestamps, errors. Not collected: M-Pesa PINs, card numbers, or passwords "
        "through WhatsApp or the website."
    )
    p(
        "Use: process prepaid orders and hold escrow; send order, shipment, and payout updates; "
        "moderate listings and enforce policy; review pickup applications and pay commissions; "
        "power Plug on the local catalog; improve feed ranking; display reviews (first name "
        "and comment); post marketing such as TikTok featuring products, not private messages; "
        "prevent fraud and abuse. Conversational AI: by using Plug you agree to processing "
        "needed to fulfil requests. What goes to AI is message text and relevant catalog or "
        "order context, not PINs or cards. Scope is local listings. Providers are reached "
        "through the backend. Chat history and phone numbers are not sold to third-party "
        "marketers."
    )
    p(
        "Third parties named: WhatsApp and WAHA for messaging; Paystack for STK collections "
        "and seller payouts; Safaricom Daraja as optional STK fallback; Cloudflare for website "
        "hosting and security; AI providers for replies; TikTok for optional social posting. "
        "Each has its own policy. WhatsApp is Meta; using WhatsApp is also Meta's terms. "
        "Sharing: no sale of personal data. Shared with sellers for fulfillment, logistics "
        "and pickup partners for delivery or collection, service providers under contract, "
        "authorities when required by law. Listing photos and descriptions are public. Seller "
        "phones may be used internally for payout and coordination. Approved pickup shops may "
        "appear with name, area, hours. Retention: as long as needed for business, legal, "
        "escrow, and support, then delete or anonymise. Security: HTTPS, access controls, "
        "token-gated admin APIs; no online service is one hundred percent secure. Rights "
        "under Kenya's Data Protection Act 2019: access, correction, deletion, including "
        "phones and delivery addresses, via WhatsApp or email, answered in a reasonable time. "
        "Not directed at children under 13. Some providers may process outside Kenya where "
        "needed. The last-updated date changes when the policy changes; material changes "
        "may be announced on the site or channel. Privacy contact is the same WhatsApp, "
        "email, and website."
    )

    # ------------------------------------------------------------------
    h1("22. Hosting, the production VM, and operations")
    p(
        "The website and the bot are deployed differently because they fail differently. "
        "A static site can sit on a CDN and survive a bot restart. A WhatsApp session cannot. "
        "That is why sokonimall.com is Cloudflare static assets, and why bot.sokonimall.com "
        "is a virtual machine that stays up."
    )
    h2("Website deploy")
    p(
        "The storefront folder is the publish root. Wrangler configuration points assets "
        "at website/. Merges to the main branch publish Cloudflare. There is no application "
        "server for HTML. Local preview is any static server. After website-motion changes, "
        "the motion package is built into website/assets/js/sokoni-motion/ and those built "
        "files travel with the site. Reviews and live catalog still come from the bot at "
        "request time, so a site deploy without a bot does not update prices by itself."
    )
    h2("The production VM")
    p(
        "The documented production path is a Google Cloud e2-micro Always Free VM. Oracle "
        "Cloud Always Free ARM is the documented alternative with more headroom. Render "
        "appears in older notes as a possible split — bot on Render, WAHA kept awake somewhere "
        "that does not sleep — and is not the main layout. There is no render.yaml in the "
        "repository. On the VM, nginx holds the TLS certificate for the bot hostname. The "
        "Node process is managed by PM2. WAHA runs in Docker with a NOWEB engine suited to "
        "small machines. Small RAM means swap is part of the documented GCP story. Postgres "
        "can run in Docker on the same box. A Remotion worker runs as a second PM2 process "
        "on loopback so Chromium work is isolated."
    )
    p(
        "GitHub Actions can SSH to that VM when bot code changes and run the deploy script: "
        "install dependencies, migrate, restart the bot. Operators often skip restarting "
        "WAHA so the linked WhatsApp session survives. Health checks hit the public /health "
        "URL. WAHA linking uses a pairing flow on the machine; the admin UI is not a public "
        "website. Backups encrypt the bot's data directory — orders, settlements, withdrawals — "
        "because a git reset deploy does not version those files. Postgres volumes, environment "
        "files, and the WhatsApp session are separate restore stories. Losing the session "
        "means pairing again, not restoring a tarball."
    )
    h2("What the database is for")
    p(
        "When it is on, Postgres holds users with roles such as buyer, seller, and staff; "
        "seller profiles; products with condition and stock; orders and items with status "
        "from pending through paid toward delivered, cancelled, or refunded; payments; "
        "shipments and rider fields; social follows, likes, offers, messages, reviews; "
        "audit logs on custody changes. Order status machines reject a casual cancel after "
        "pickup or in transit unless a force path for admin, dispute, or no-show return "
        "says so. File-backed orders remain important for the live cart. Dual-write is the "
        "bridge, not a surprise cutover."
    )
    h2("Security habits")
    p(
        "The browser is public. Secrets stay on the bot environment, not in JavaScript. "
        "CORS allowlists the storefront origin. Webhooks are authenticated. Public APIs "
        "are rate-limited. Admin HTML is not for search engines. Catalog can be paused "
        "with a flag so selling stops without taking the CDN down. This handbook does not "
        "list credentials, private network addresses, or the steps that would let a stranger "
        "operate a desk."
    )
    h2("Operator catalogs and flags")
    p(
        "Staff WhatsApp palettes can pause the catalog, sync it, inspect stock, flip prepaid "
        "flags, and run database migrate or seed. Platform flags live in a data file on "
        "the bot: prepaid only, sync on publish, maintenance, multi-seller cart. The go-live "
        "habit is: do not break wa.me links, do not break bot APIs, do not migrate the whole "
        "site to a new framework unless that is the actual project. One surface at a time. "
        "If motion fails, the shop still sells."
    )

    # ------------------------------------------------------------------
    h1("23. Commands in real conversations")
    p(
        "Commands are not a cheat sheet for their own sake. They are sentences people type "
        "when they are in a hurry on a boda or in a shop. This chapter puts them back in "
        "speech. Formats below use SKN-1002 as the FAQ does. OTPs in examples are fake "
        "shapes, not live codes. Plug never invents a real OTP."
    )
    h2("Anyone")
    p(
        "Someone new says hi, menu, or start. They should land on a menu they can number-reply. "
        "Someone mid-browse who is lost says menu again and the aisle resets. Someone with "
        "a parcel in the wild pastes SKN-1002 or types track. Someone whose STK vanished "
        "types pay, retry, stk, or lipa. Someone who used the till shown on checkout types "
        "paid and the M-Pesa code. Numbered replies 1, 2, 3 pick list lines. That is the "
        "whole public grammar for people who are not yet buyers, sellers, or riders."
    )
    h2("Buyers")
    p(
        "A box is on the table in Kakamega, courier, no rider. The buyer looks, it is right, "
        "they type YES SKN-1002. A box is wrong. They type HELP SKN-1002 or DISPUTE SKN-1002 "
        "and send photos. They do not also send the Delivery OTP. After a good local delivery "
        "they may RATE 5, then rate the shop if asked. They never need to type CONFIRM; that "
        "is the rider's line. They never need to type ACCEPT. If Plug hears 'confirmia hiyo "
        "order', it tells the rider the CONFIRM format, and tells the buyer to hand over the "
        "OTP only after they have looked."
    )
    h2("Sellers")
    p(
        "A new shop says SELL and stays in the thread until the pin is saved. An existing "
        "shop says vendor menu for the hub list. balance and WITHDRAW are wallet, not "
        "customer chat. DISPATCH SKN-1002 is the upcountry or hub 'it has left me' flag. "
        "WAYBILL SKN-1002 Fargo 123456 plus two photos is the courier evidence. PARTIAL_REFUND "
        "SKN-1002 200 is a deliberate shilling amount, not 'rudisha kitu'. Stock and price "
        "changes belong in the Hub or in authenticated tools, not in a rumour to Plug."
    )
    h2("Riders")
    p(
        "RIDER APPLY is how they join. ACCEPT SKN-1002 is how they take today's offer. "
        "PICKUP SKN-1002 4821 is how they take the parcel. CONFIRM SKN-1002 7391 is how "
        "they finish, with GPS. DECLINE if they cannot. NO_SHOW if the house is empty in "
        "the agreed way. AVAILABLE and OFFLINE change whether offers come. They do not type "
        "WITHDRAW. They do not ask the buyer to STK them. If they paste only 7391, Plug "
        "should give the full CONFIRM line, not guess the SKN."
    )
    h2("Pickup shops")
    p(
        "pickup menu or pick up point opens the partner flow. Release still depends on "
        "Sokoni's confirmation, not on a neighbour who knows the buyer's nickname."
    )
    tbl(
        ["Who", "They type", "What should happen"],
        [
            ["New shopper", "hi / menu", "Numbered menu, language follows the user."],
            ["Buyer paying", "pay / paid", "STK retry, or match a confirmation code."],
            ["Buyer happy, courier", "YES SKN-1002", "Receipt confirmed, escrow can move."],
            ["Buyer unhappy", "HELP SKN-1002", "Payout frozen, photos, human resolves."],
            ["Seller joining", "SELL", "Shop name, handle, payout, required pickup pin."],
            ["Seller shipping far", "WAYBILL SKN-1002 …", "Tracking stored with two photos."],
            ["Rider joining", "RIDER APPLY", "In-chat KYC, then PENDING."],
            ["Rider on a job", "ACCEPT / PICKUP / CONFIRM", "Custody moves only with OTPs and GPS."],
        ],
        [32, 48, 90],
    )

    # ------------------------------------------------------------------
    h1("24. Official contacts and how to verify the business")
    p(
        "People will impersonate marketplaces. The defence is a short list that does not "
        "grow. Website https://sokonimall.com. Bot APIs https://bot.sokonimall.com. WhatsApp "
        "and voice +254 117 422 428. Email support@sokonimall.com. Human hours about 07:30 "
        "to 21:00 East Africa Time. Registered name SKN MALL KENYA. Number BN-36SM2YW9. "
        "SMS BRS to 21546, then that number. Registered office Murang'a Union Building, "
        "Thika–Kandara Road, P.O. Box 220, 01034 Kandara. Governing act Registration of "
        "Business Names Act, Cap. 499. Issuing authority Business Registration Service."
    )
    p(
        "Buyer-trust knowledge tells Plug not to invent other emails, phones, or a city-only "
        "head office story. If a flyer shows a different WhatsApp, treat it as unverified. "
        "If a rider reads a till, treat it as not Sokoni. If a seller says pay me to skip "
        "escrow, that is off-platform and against vendor terms. Verify the SKN on the official "
        "number before any PIN is entered."
    )
    tbl(
        ["Channel", "Use this"],
        [
            ["Website", "https://sokonimall.com"],
            ["Commerce API host", "https://bot.sokonimall.com"],
            ["WhatsApp and calls", "+254 117 422 428"],
            ["Email", "support@sokonimall.com"],
            ["Human support", "Talk to a Human on WhatsApp, 07:30–21:00 EAT"],
            ["Business name", "SKN MALL KENYA"],
            ["BRS number", "BN-36SM2YW9"],
            ["Verify", "SMS BRS to 21546"],
        ],
        [45, 125],
    )

    # ------------------------------------------------------------------
    h1("Worked example: one prepaid order from search to payout")
    p(
        "This is a single story with every role on the same SKN, so the clocks make sense "
        "together. A buyer in Ruiru opens sokonimall.com, signs in with email, searches "
        "pre-loved linen, and opens a shop listing from a seller in Thika. The sheet shows "
        "KES 2,400, an escrow badge, and Order. She adds it to the bag with a second item "
        "from another shop at KES 1,100. Checkout builds a parent SKN-1002 and children "
        "SKN-1002-1 and SKN-1002-2. She drops a map pin on her gate, sees a local rider "
        "fee calculated from the Thika seller pin to Ruiru (the second seller is also in "
        "the metro), and pays one STK on the combined total plus the banded M-Pesa fee. "
        "SOKONI3 takes three percent off the eligible goods if she entered it in chat or "
        "if the web path applies it; it does not delete the rider fee."
    )
    p(
        "STK succeeds. Both sellers are notified only now. Seller A prints label.html for "
        "SKN-1002-1. A rider is offered the first local leg, types ACCEPT SKN-1002-1, "
        "collects with PICKUP and the seller OTP, rides to Ruiru. The buyer inspects the "
        "linen, is happy, speaks the Delivery OTP. The rider CONFIRMs with GPS inside two "
        "hundred metres. Fifteen minutes later the rider fee is eligible for the next sweep. "
        "The linen child's escrow can move toward the seller after the inspection logic. "
        "Seller B is slower. Twelve hours have not yet passed. If Seller B never dispatches "
        "SKN-1002-2, that child refunds; SKN-1002-1 is not clawed back. If Seller B dispatches "
        "by rider the same afternoon, the buyer may receive two knocks. Each CONFIRM is "
        "its own OTP. Mixing OTPs is how custody breaks; the command always carries the "
        "child SKN."
    )
    p(
        "If the linen had a stain not in the photos, the buyer would not speak the OTP. "
        "She would photograph the stain within two hours, HELP SKN-1002-1, and keep the "
        "second item's journey independent. Support would see a frozen child, not a frozen "
        "life. That is why parent plus children exists."
    )

    h1("Worked example: upcountry courier")
    p(
        "A buyer in Kisumu orders a brand-new blender from a Nairobi shop. Checkout is "
        "not a boda formula. The seller's Hub rate for Kisumu, or the county tier, is "
        "applied before STK. After pay, no rider is pinned. The seller packs, photographs "
        "the blender next to the waybill, photographs the sealed parcel, types WAYBILL "
        "SKN-1008 Fargo or whichever sacco, and DISPATCH. The tracker shows in transit. "
        "Two days later the blender is at the door or at a pickup shop. The buyer inspects. "
        "There is no rider OTP. They type YES SKN-1008. The forty-eight hour upcountry "
        "window is the one Plug should quote if a lookup returns it. If the blender arrives "
        "cracked, HELP plus photos, no YES."
    )
    p(
        "If the seller had tried to charge a 'Nairobi boda rate' of KES 200 on this Kisumu "
        "job, that would be the wrong tariff family only if someone later converted the job "
        "into a metro rider job. Upcountry, the seller's rate is the rate. Local metro, "
        "Sokoni's distance formula is the rate. The blender never becomes a KES 400 minimum "
        "rider job unless both pins sit inside the metro and the engine classifies it that way."
    )

    h1("Worked example: first-time seller")
    p(
        "A thrift seller in Eastlands messages SELL. Plug and the command path collect "
        "a shop name, a handle, an M-Pesa number for payout, and then refuse to finish "
        "until a pin lands on the actual rack. She stands at the stall, sends current "
        "location, lists a jacket with four photos, marks it pre-loved, sets stock 1, "
        "sets a ten percent item promo because she wants movement, not because SOKONI3 "
        "already exists. The listing may go live immediately. If the photos are of a "
        "counterfeit box, moderation or check_aup can pull it. A buyer pays. She does "
        "not receive the cash. She receives a paid order and a label. A rider arrives. "
        "She speaks the Pickup OTP, does not hand the jacket to a cousin who 'will drop "
        "it'. After CONFIRM she watches Ready and withdraws to the number she registered, "
        "not to a new number in chat."
    )
    p(
        "If her first week is all KES 400 deliveries, she should open the Hub map and "
        "confirm the pin is the stall, not last night's house. If she listed without "
        "variants and sold a size that does not exist, she has oversold: PARTIAL_REFUND "
        "or a support path, not a quiet ignore. Vendor terms say overselling hurts trust. "
        "Escrow is how that hurt becomes a ticket instead of a street argument."
    )

    h1("Worked example: first-time rider")
    p(
        "A rider in Thika types RIDER APPLY, sends ID front, Class A licence, stage letter, "
        "plate, and a stage pin. PENDING. The next day VERIFIED. He types AVAILABLE and "
        "shares Live Location. An offer for SKN-1010 arrives. He ACCEPTS. At the shop he "
        "types PICKUP with the seller's four digits. At the gate the buyer is not around. "
        "He does not CONFIRM with a code someone read on the phone. He uses NO_SHOW in "
        "the documented way and lets ops and the buyer sort it. Another job, the buyer is "
        "there, inspects, speaks the OTP, he CONFIRMs standing at the gate. Thirty to "
        "forty-five minutes later he should not yet panic about M-Pesa. Under KES 200 "
        "owed waits. Over KES 5,000 in a day waits until tomorrow. He never asks the "
        "buyer for fuel money. The boda marketing page called these escrow-backed jobs "
        "for a reason: the fee is already in the hold."
    )

    h1("When payment, dispatch, or delivery fails")
    p(
        "STK did not arrive. Causes worth checking in support language: the phone on the "
        "order is not the M-Pesa phone, the amount is outside what that rail will prompt, "
        "or the prompt expired. The buyer types pay. They do not send to a number a helper "
        "invents. If they used the till that checkout itself showed, they type paid plus "
        "the code so verify_payment_code can match a webhook. Screenshots without codes "
        "are weak evidence. Codes that do not match a webhook are not paid."
    )
    p(
        "Seller silent for twelve hours. The trust page is the script: refund the buyer, "
        "do not pay the seller. If the payout rail to the buyer is down, queue the refund, "
        "still do not pay the seller. Plug must not promise a minute. It must not keep "
        "the seller's hope alive past the policy."
    )
    p(
        "Marked delivered, buyer says they never saw a parcel. HELP SKN-####. Escrow stays "
        "held. GPS logs on CONFIRM matter here: if CONFIRM happened two kilometres away, "
        "that is evidence. If CONFIRM happened at the pin, support still listens, because "
        "a gate photo and a neighbour can disagree. The rule is not 'rider always wins'. "
        "The rule is escrow stays until a human reads the file."
    )
    p(
        "Wrong item, photo in two hours. Freeze. Photo after two hours but inside forty-eight. "
        "Still a Terms §7 claim; if auto-release already paid the seller, support reverses "
        "manually. Plug still must not invent the shilling figure of that reverse. Damaged "
        "in sacco with WAYBILL photos that show a sound item at dispatch: that is a courier "
        "conversation with evidence, not an automatic accusation of the seller. Empty box "
        "with no pre-seal photo: the seller is in a worse position because they skipped "
        "the two-photo rule."
    )
    p(
        "Rider cannot CONFIRM because drop-off GPS is not on file. Do not tell them to "
        "resend their own pin. The buyer's pin is missing. Ops sets it. Meanwhile the "
        "buyer should not be pressured to speak an OTP into a phone call. OTP plus GPS "
        "is the pair. Breaking the pair is how fake deliveries happen."
    )
    p(
        "Buyer wants COD at the door. Script from payment rules: acknowledge, escrow not "
        "seller, inspect then OTP or YES, refund path for wrong goods, next step. Never "
        "yes we can do cash today. Rider asking for cash is a report, not a negotiation."
    )

    h1("Inbox, offers, bundles, and the social shop")
    p(
        "The inbox is not a second WhatsApp. It is a logged thread between a site account "
        "and a shop, with offers and bundles that can become escrow orders. A buyer can "
        "ask for measurements, send a fit photo, or offer KES 2,000 on a KES 2,400 jacket. "
        "If the offer is close and the buyer has history, a background agent may nudge the "
        "seller once in thirty minutes, not every minute. The seller accepts or declines "
        "in the Hub or inbox. Acceptance does not spray M-Pesa to the seller. Acceptance "
        "creates or updates a checkout that still STKs into escrow."
    )
    p(
        "Bundles are how a shop sells two listings together without a fake SKU. The money "
        "still has to land as prepaid lines. Media in the inbox is for fit and evidence, "
        "not for collecting IDs that privacy policy did not describe. Inspection-claim and "
        "release-funds actions in the inbox after delivery are the same escrow story as "
        "HELP and YES, with a UI. They are not a back door for staffless refunds."
    )
    p(
        "Follows and likes feed the home rails. They also create the Following tab. A shop "
        "with no follows still appears in Explore and search. Reviews are supposed to come "
        "from delivered SKNs so a rival cannot one-star a shop they never paid. Weighted "
        "ratings exist in internal notes so a single five-star does not outrank a hundred "
        "honest fours. Public shop pages remain shareable without login so TikTok bios can "
        "point at a handle."
    )

    h1("Order statuses, from unpaid to paid out")
    p(
        "Awaiting payment means an SKN exists and STK has not succeeded. The catalog may "
        "not yet be locked. Abandoned awaits should not dispatch riders. Paid means escrow "
        "holds funds, labels can print, sellers can be told, local offers can go to riders. "
        "Label_ready is the logistics twin of paid. Dropped_off is a hub or seller scan. "
        "In_transit is a rider ACCEPT plus pickup, or a courier WAYBILL. At_pickup_point "
        "is a shop holding a prepaid parcel. Delivered is the status buyers argue about: "
        "it should mean the OTP plus GPS or a YES, not a hopeful tap. Cancelled after pay "
        "is not a casual menu item once a rider has pickup; the status machine rejects "
        "cancel after pickup or in transit unless a force path for admin, dispute, or "
        "no-show return is used. Refunded is the end of a buyer-win. Seller Ready is not "
        "an order status; it is a wallet state after release. Rider held fifteen minutes "
        "is not an order status either; it is a fee state."
    )
    p(
        "Disputed or held_for_dispute sits beside these. Auto-release should not pay a "
        "held child. A parent cart can have one child delivered and one child disputed. "
        "Dashboards that show a single emoji for a mixed bag are lying; track.html should "
        "not. Audit logs on status changes exist so a CONFIRM cannot be a rumour."
    )

    h1("Browse departments and how merchandising actually works")
    p(
        "The browse menu is versioned JSON so the website rail, the flyout, and Plug's "
        "taxonomy tool stay cousins. Women is not a vibe; it is tops, dresses, skirts, "
        "jumpsuits and sets, jeans, outerwear, activewear, sleepwear, lingerie, maternity, "
        "shoes, heels, and further children as the file grows. Men, beauty, electronics, "
        "supermarket, auto, food, and wine sit beside that tree. Aesthetics are orthogonal: "
        "a Y2K dress is still a dress. Price tiers are filters, not categories. Brand new "
        "versus pre-loved is a condition flag, isSecondhand, not a department. If a seller "
        "dumps a blender into Dresses, search will embarrass them and Plug will still try "
        "to be helpful from the words in the title. Category choice is part of listing "
        "quality."
    )
    p(
        "Demand tags and trending rails are scored from events, not from who paid for a "
        "slot in the MVP. Featured placement as a paid product is a concept-era revenue "
        "idea; the live feed is behaviour. TikTok featured JSON is an editorial or automation "
        "overlay on that feed, still local store SKUs. Catalog pause is an ops flag: the "
        "site can show a paused catalog rather than sell stock you cannot fulfil during "
        "an incident."
    )

    h1("Public APIs the website already calls")
    p(
        "This is a map of prefixes, not a keyring. /api/products lists and details and likes. "
        "/api/search finds. /api/reviews is sitewide social proof. /api/feed is home rails "
        "and event posts. /api/checkout is order lookup, shipping calculate and apply, STK, "
        "landmarks, labels, pay-by-reference. /api/tracking is timeline and rider point. "
        "/api/disputes is mine, open, inspection, seller response. /api/account/auth is "
        "email identity. /api/buyer/auth is WhatsApp OTP. /api/social is shops, follow, "
        "chat, offers, bundles, activity. /api/seller/listings is draft, studio, publish, "
        "bulk. /api/seller/onboard is the hub session, orders, ledger, withdraw, stock, "
        "dispatch, promo. /api/agent is Plug. /api/pickup-points is info, directory, apply. "
        "/api/riders/register is boda apply from the web form. /api/trust/ticker is the "
        "home strip. /catalog-images/ is media. /health is liveness for humans and scripts."
    )
    p(
        "Local development may point those same paths at a machine port. Production buyers "
        "should only ever see bot.sokonimall.com as the API host in the site's configuration. "
        "Admin command prefixes exist on the same host and are out of scope for customer "
        "documentation. CORS should not allow a random origin to drive STK."
    )

    h1("WhatsApp menus, language, and a sample thread")
    p(
        "A first message that is only 'sasa' should still be greetable in Sheng and then "
        "offer a menu or a search. A first message that is 'mko na official wear size 36' "
        "should search, not insist on tapping Fashion. Historical menu copy in old flow "
        "documents mentioned Shop International. Live Plug stable facts say local catalog "
        "only, no AliExpress, Temu, or Amazon. If a menu remnant still shows an international "
        "row in some build, the honest answer is the FAQ: Sokoni does not sell those orders. "
        "Do not collect duty lectures for a product you will not fulfil."
    )
    p(
        "A realistic prepaid thread looks like this, compressed. Buyer: 'uko na pre-loved "
        "samba 42?'. Plug: two live listings with KES and photos, numbered. Buyer: '1'. "
        "Bot: name, where should it go, pin please. Buyer sends location. Bot: STK sent "
        "for SKN-1012, include delivery in the total, escrow until you confirm. Buyer pays. "
        "Bot: paid, seller packing, track with SKN-1012. Later: rider on the way. Buyer "
        "inspects, gives OTP. Rider CONFIRMs. Bot can ask RATE. That is the whole happy "
        "path. A sad path inserts HELP and photos and a human. Plug stays short. Humans "
        "write longer."
    )
    p(
        "Talk to a Human is a menu row and a working hours promise, not a second phone "
        "number. Inside hours, a person picks up the same thread. Outside hours, Plug and "
        "tracking still answer. Legal threats still open HITL even if the clock is late."
    )

    h1("Staff desks, in language customers never need")
    p(
        "Someone has to freeze a shop, pay a stuck rider, read a dispute photo, and pause "
        "the catalog at 2 a.m. The static admin pages are that workplace: command for live "
        "orders and escrow, ops for a socket-connected queue, support for scripted commands, "
        "finances for release and logs, disputes for tickets, listings for flags and KYC, "
        "shops for seller desks, boda for verify and payout runs, riders for fleet. They "
        "are noindex. They require a staff credential this handbook will not describe. "
        "The important product fact is that Plug is not those desks. When Plug says a team "
        "member will pick this up, it means a human on one of those surfaces, in the same "
        "WhatsApp number, not a new wa.me."
    )
    p(
        "Executive briefings, high-value paid-order pings, and numbered dispute cards are "
        "how those humans get a pulse without living in SQL. Voice-to-command on a staff "
        "phone is for hands-busy ops, not for buyers. If a buyer copies the tone of a "
        "staff card, nothing money-shaped should happen."
    )

    h1("Catalog publishing and what never hits the browser")
    p(
        "The master catalog can include private cost, supplier, and source URL fields for "
        "an operator-fulfilled store item. The publish step writes website/data/products.json "
        "without those fields. That is why you do not edit two HTML files to add a product, "
        "and why a curious buyer with DevTools should not see what you paid in Gikomba. "
        "Seller-net versus buyer price also must not leak in public APIs. Paid orders "
        "consume stock and can tombstone a SKU. Admin stock tools exist. Vision and image "
        "sync can attach photos from names when an operator catalog is being seeded; live "
        "marketplace sellers still upload real photos of the actual item, which is the "
        "only honest pre-loved path."
    )
    p(
        "Daily affiliate price sync still exists as code from the concept era. The live "
        "FAQ says you cannot buy AliExpress through Sokoni. Do not run a sync that would "
        "reintroduce overseas checkout into a prepaid Kenya escrow bag without a product "
        "decision that also rewrites FAQ, terms, and Plug stable facts together."
    )

    h1("Motion, accessibility, and what 'fail-soft' means")
    p(
        "The motion bundle uses LazyMotion and m-components, stagger on grids of about "
        "forty to sixty milliseconds, durations around two to three tenths, easeOut, spring "
        "sheets with stiffness near three hundred and damping near twenty-five. Primary "
        "buttons scale on tap toward 0.95 to 0.97, hover at most 1.03. Only opacity and "
        "transform. Heavy backdrop blur on large grids is avoided because mid-range Androids "
        "drop frames. prefers-reduced-motion: instant or opacity only. Focus-visible rings "
        "on interactive elements. Contrast of purple on cream and dark text on green buttons "
        "is supposed to pass WCAG 2.2 AA. Forms need labels. None of that is decoration. "
        "A shopper on a noisy matatu is the real device test."
    )
    p(
        "Fail-soft means if sokoni-motion.js 404s or throws, app.js still renders cards, "
        "wa.me still works, checkout still posts STK. Path B exists because rewriting the "
        "mall into a single-page framework was judged a way to break escrow. Design tokens "
        "live in design-tokens.css. DESIGN.md wins arguments about colour and voice."
    )

    h1("Data protection in operational language")
    p(
        "Kenya's Data Protection Act 2019 is not a footer decoration. Phones, addresses, "
        "and IDs are collected because parcels move. They are not a marketing list. Feed "
        "events on the website are described as anonymous session events. Reviews show a "
        "first name and a comment, not a national ID. Pickup applications include M-Pesa "
        "details because commission is paid; those details are not a public directory field. "
        "Seller listing photos are public by nature of a shop. Chat with Plug sends text "
        "and catalog context to model providers through the backend. People can ask for "
        "access, correction, or deletion. Children under thirteen are not the audience. "
        "Cross-border processing happens because Cloudflare and some AI providers are not "
        "Kenyan companies; the policy says that out loud."
    )
    p(
        "Retention follows escrow. You cannot delete an order tomorrow that still has a "
        "held payout and a dispute photo. You also should not keep a pickup applicant's "
        "documents forever after a rejection without a reason. The policy's 'as long as "
        "needed then anonymise' is the instruction. This handbook does not add a secret "
        "longer retention."
    )

    h1("Countrywide voice, hubs, and why the BRS address is not the service area")
    p(
        "Every public page that mentions Kandara is at risk of being read as 'Sokoni is "
        "a Murang'a shop'. The About page already fights that reading: the address is the "
        "BRS record, shoppers and sellers across Kenya use the same prepaid WhatsApp "
        "marketplace. Design rules say never anchor marketing to a single city. Delivery "
        "copy should say home delivery and pickup points, not 'Nairobi same day' as a brand "
        "promise. Riders today are recruited in Nairobi and Thika; that is a fleet fact, "
        "not a sales-area claim. Upcountry is supposed to work through sellers, saccos, "
        "and pickup shops. If a county has no pickup partner yet, checkout should still "
        "let a seller quote a courier rate rather than pretend a boda will leave Thika "
        "for Mandera at KES 400."
    )
    p(
        "Mashinani hubs in Plug's stable facts are the countrywide drop-off idea: a seller "
        "prints a label, drops, the tracker moves. That is how a closet seller without a "
        "rider-friendly pin still ships. Hubs are not cash offices. They do not collect "
        "balances. They scan and store."
    )

    h1("How humans and models divide the work")
    p(
        "If it changes who holds a parcel or who holds money, it is a command or a callback. "
        "If it explains a policy, searches a catalog, or comforts a COD objection, it is "
        "Plug. If it is a close offer nudge, it is a level-1 fabric listener. If it is a "
        "refund amount, it is a human or a bounded command a seller typed. If it is a "
        "twelve-hour silent seller, it is automation plus a rail. If it is a legal letter, "
        "it is a human, immediately. That division is the AI architecture document in one "
        "paragraph, and it is why this handbook spent so many pages on OTPs."
    )
    p(
        "Updating knowledge markdown does not wipe the model's English. It updates the "
        "manual. When launch logs show a wrong answer, add a Stable Fact, deploy the bot, "
        "do not fine-tune a private personality. Conversation memory on WhatsApp is short "
        "context, not a second brain. Review it. Promote repeating questions into knowledge "
        "files. Register those files in the specialist lane docs so dispute questions do "
        "not retrieve the wrong SOP."
    )

    h1("Policy files the assistant is grounded on")
    p(
        "Plug does not 'know Sokoni' in the way a staff member who packed boxes knows it. "
        "It is given short markdown files at retrieval time. Those files are the difference "
        "between a generic shopping chatbot and this marketplace. What follows is the "
        "substance of each file in handbook prose, so a human can read the same rules "
        "without opening the repository."
    )
    h2("Escrow and payments")
    p(
        "There is no cash on delivery because there is an automated M-Pesa escrow system. "
        "It protects buyers from scams and fake goods, and sellers from prank orders and "
        "delivery theft. Cash handovers leave no record. The buyer pays STK, or the Buy "
        "Goods till when STK fails. Sokoni holds the funds. The seller does not receive "
        "them at that point. The seller packs. A pinned rider collects, or the seller ships "
        "upcountry. The buyer inspects, then releases: local by Delivery OTP, upcountry by "
        "YES SKN-####. Funds move after that confirmation, or after the inspection window "
        "with no dispute. A wrong, damaged, or counterfeit item raised in the window freezes "
        "seller payout, collects photos, and refunds to M-Pesa when the claim holds. HELP "
        "or DISPUTE is the freeze syntax. The assistant never quotes a refund amount, never "
        "releases, never promises a payout date."
    )
    p(
        "Accepted rails are STK and the till fallback. Not accepted: COD, paying a rider, "
        "personal numbers, mystery tills in chat. Fees the buyer sees: item, seller shipping "
        "where applicable, banded M-Pesa fee on the total. Nothing at the door. Sokoni never "
        "asks for a PIN. Never invent a till. Only the prompt or the till on checkout is valid. "
        "The COD objection answer is always acknowledge, escrow not seller, inspect then "
        "release, refund path, next step."
    )
    h2("Returns")
    p(
        "Funds stay held until delivery is confirmed or a dispute is resolved. Wrong item "
        "or damage: report on WhatsApp, ticket opens, payoutStatus held_for_dispute, photos. "
        "Missing package: HELP or Talk to a Human. Plug never invents refund amounts. Legal "
        "threats go to humans. Admins resolve in Admin Disputes. Buyers and AI open. Admins close."
    )
    h2("Buyer trust")
    p(
        "Never share PIN. Pay only official prepaid STK on Sokonimall, not random tills. "
        "Track with SKN-####. HELP freezes escrow. Local: seller hands over only with Pickup "
        "OTP; buyer confirms with Delivery OTP as CONFIRM SKN-#### ####. Platform promos are "
        "small; sellers may set item-level promos. Official contacts are the ones in chapter "
        "24. Do not invent others. Human hours about 07:30–21:00 EAT."
    )
    h2("Seller onboarding, payouts, vendor terms")
    p(
        "SELL in chat or Hub OTP on the web. Pickup pin required, no skip. Payout details "
        "in Hub settings. First listing is photos plus the price the seller receives. Promos "
        "are per listing. Shipping zones: upcountry seller, local rider platform. After "
        "confirmation, net is scheduled. Withdraw from Hub or WhatsApp. Instant when the "
        "rail is on, otherwise a queue. Low stock at two units alerts WhatsApp. Shop banner "
        "is copy, not a price. Vendor terms: accurate photos size colour stock, no overselling, "
        "prohibited listings removed, shops can be paused, sellers handle dispatch notes, "
        "edit catalog in the Hub not via AI guesses, never ask buyers to pay a personal till."
    )
    h2("Riders")
    p(
        "Apply in chat or on the web form. Nairobi or Thika. Documents as listed in chapter "
        "15. Jobs auto-offered. ACCEPT, PICKUP, CONFIRM, optional DECLINE, NO_SHOW, "
        "VERIFY_RETURN, AVAILABLE, OFFLINE. CONFIRM needs OTP and GPS within 200 m. Live "
        "Location when online. No withdraw command. Fifteen minute hold, thirty minute sweep, "
        "KES 200 floor, KES 5,000 daily cap, high fees ops-checked. On KES 400 the rider "
        "nets KES 345 after the documented cuts."
    )
    h2("Pins, pricing, shipping SOP")
    p(
        "Pins are coordinates. Seller required, rider optional, buyer per order preferred. "
        "Refuse 0,0, swapped, outside Kenya. WhatsApp: Attach, Location, current location. "
        "Local rider price is Sokoni's formula. Upcountry is seller tiers. Never quote a "
        "specific-order fee in chat. Buyers after prepaid may get a pinned rider or a "
        "waybill. Track SKN. Damaged: HELP. After confirm, about fifteen minutes hold on "
        "local rider jobs before payout rails. Sellers set only upcountry prices in Hub. "
        "Local: Sokoni pins, handover only with Pickup OTP. Upcountry: WAYBILL plus two "
        "photos. AI explains and reads lookups. AI does not invent rates, OTPs, or pins."
    )

    h1("Clocks, in one place")
    p(
        "Twelve hours after payment with no dispatch: refund the buyer, do not pay the "
        "seller. Two hours after marked delivered: a problem photo freezes payout if saved. "
        "Fifteen minutes after local CONFIRM: rider fee hold, also a short buyer shout window "
        "on that fee. Twenty-four hours after local delivery: default auto-release if no "
        "dispute, unless the order's own autoReleaseHours says otherwise. Forty-eight hours "
        "after upcountry delivery: the longer auto-release. Forty-eight hours after delivery "
        "either way: Terms §7 claims still valid, even if money already moved, in which case "
        "humans reverse. Two to three business days after delivery status: typical seller "
        "payout language in terms. A few hours on business days: payout-detail verification "
        "language for new sellers. About twenty-four hours: rider application review language, "
        "not a promise. Five days: pickup shop hold unless agreed otherwise. Seventy-two "
        "hours: feed event decay. Hourly: trending rebuild. Thirty minutes: rider M-Pesa "
        "sweep. Support 07:30–21:00 EAT: humans. Always: Plug for catalog and track, commands "
        "for money."
    )
    p(
        "These clocks overlap on purpose. A two-hour photo is the fast freeze. A twenty-four "
        "hour auto-release is the seller's protection against a buyer who vanished after "
        "taking the parcel. A forty-eight hour term is the fairness layer if someone notices "
        "a hidden defect the next day. Operations should not collapse them into one number "
        "in a WhatsApp reply. Quote the order's own window when a lookup has it."
    )

    h1("Seller Hub, screen by screen")
    p(
        "The Hub is one HTML page with many jobs, which is why new sellers get lost. Start "
        "at phone OTP. Without it there is no ledger. Shop profile is name, handle, bio, "
        "avatar, optional TikTok URL. Payouts is where M-Pesa landing details live. List "
        "item is the wizard: photos, title, price you receive, condition, category from the "
        "real tree, stock or variants. Studio is background and clip. Bulk is CSV or JSON "
        "for people with a rack already counted. Stock is the place you prevent overselling. "
        "Set promo is percent on that SKU. Shipping rates is upcountry tiers and optional "
        "map zones, not a place to undercut the metro boda formula. Orders is paid work: "
        "print label, dispatch, request boda, see OTP status without sharing the code in "
        "a screenshot group. Ledger is what escrow has made Ready. Withdraw is the button "
        "riders do not have. Disputes is the seller side of HELP. Reviews is reputation. "
        "None of these replace WhatsApp for SELL, DISPATCH, WAYBILL, or WITHDRAW. They are "
        "the same shop, two doors."
    )
    p(
        "A seller who only ever uses WhatsApp can still operate: SELL, pack, OTP, WAYBILL, "
        "balance. A seller who only ever uses the Hub can still operate if they do not "
        "ignore WhatsApp OTPs, because riders live there. The pin must exist in both worlds. "
        "If the Hub map and the WhatsApp pin disagree, distance math will look insane and "
        "CONFIRM will fail at the wrong gate."
    )

    h1("Checkout fields and why they exist")
    p(
        "Order id lookup exists because a WhatsApp SKN and a web bag must meet. Readiness "
        "meta exists because you should not STK an order that cannot be fulfilled. Landmarks "
        "and hubs exist because many Kenyan deliveries are 'stage ya X' not a street number. "
        "County dropdown exists because forty-seven counties are a real pricing and courier "
        "map. Map pin exists because riders and fees are geometry. Calculate-shipping exists "
        "so the STK amount is honest. Apply-shipping writes that amount onto the order before "
        "the prompt. Buyer WhatsApp OTP exists so the paying phone is a phone Sokoni can "
        "message. STK post exists because PIN entry is Safaricom's screen. Pay-by-reference "
        "exists so a Paystack-shaped callback can find the SKN. Label fetch exists after "
        "pay, not before, because an unpaid QR is an invitation to ship for free."
    )
    p(
        "Accepted-offer checkout exists so a negotiated inbox price is not fulfilled as a "
        "handshake. The fields still include hub or landmark when that is how the parcel "
        "will move. Soft-gating checkout means a logged-out buyer may be asked to sign in; "
        "track remains public so a relative with the SKN can watch the stepper."
    )

    h1("Application forms, field by field")
    p(
        "Boda apply, web or chat, asks for full name because payouts and bans need a person. "
        "WhatsApp and M-Pesa as one number because a split identity is how fees go to the "
        "wrong SIM. National ID number and front photo because this is work on public roads. "
        "Town limited to Nairobi or Thika because that is where auto-dispatch is staffed. "
        "Stage name because matching without a pin still needs a place word. Plate because "
        "a bike is an asset and a witness. Class A licence because the job is a motorcycle. "
        "Stage chairman letter because random WhatsApp accounts are not a fleet. Optional "
        "back of ID, logbook, Good Conduct, NTSA badge because vetting is faster with them, "
        "not because the form is trying to be a bank. Stage pin optional because a phone "
        "that cannot share location should not block a livelihood; it will only cost nearby "
        "offers. Non-Kenyan numbers refused because M-Pesa cannot pay them."
    )
    p(
        "Pickup apply asks shop name, contact, location, hours, and M-Pesa for commission. "
        "It asks you to be a physical shop with storage and regular hours because a parcel "
        "cannot sit in a moving pocket for five days. Privacy policy lists those fields "
        "because they are personal data. Directory display is shop name, area, hours — not "
        "the M-Pesa number. Seller Hub ID is optional at list time; it is not optional if "
        "you want to look like a business that can survive a dispute. Buyer email accounts "
        "ask less because a shopper is not being paid."
    )

    h1("A single Plug turn, slowly")
    p(
        "Someone types 'nimetuma pesa SKN-1012 but sijapata tracker'. The webhook receives "
        "it. The command router looks for ACCEPT, PICKUP, CONFIRM, pay, HELP, a bare SKN. "
        "It may already fetch the order because SKN-1012 is in the line. If this is not a "
        "strict command, the graph asks: buyer or seller? The phone's role and the words "
        "say buyer. Allowlist includes track_order and verify_payment_code and store_info. "
        "Tools run: track_order on SKN-1012, maybe verify if a code is also present. RAG "
        "may pull payments.md. Dynamic context injects recent orders. The model sees LOOKUP "
        "RESULTS, not a browsing internet. It must answer from those. If the lookup says "
        "awaiting payment, it does not congratulate them for paying. If the lookup says "
        "paid and label_ready, it tells them the tracker in short sentences, SKN bold, URL "
        "on its own line if a label exists. If lookups are empty it admits it and escalates. "
        "It does not invent a table of other SKNs. That whole path is why native tool_calls "
        "are off: the server already decided which tools were safe for this lane."
    )
    p(
        "If the same person had typed 'CONFIRM SKN-1012 7391', the router would not call "
        "the model to 'interpret intent'. Code would check they are the offered rider, the "
        "OTP matches, the GPS is close, then update custody. The model might still send a "
        "short confirmation message after, but it would not be the authority."
    )

    h1("More conversations, written out")
    p(
        "COD. Buyer: 'mnaweza leta nilipie pale?'. Plug: short acknowledgement that paying "
        "on arrival feels safer, then the swap: money sits with Sokoni not the seller, they "
        "inspect before OTP or YES, wrong item in the window is an M-Pesa refund path, and "
        "a question: want to see the listing again? No apology for not taking cash."
    )
    p(
        "Fee argument. Seller: 'Nairobi ni 200 kwangu'. Plug: local rider jobs are priced "
        "by Sokoni on pin-to-pin distance, seller Hub rates are for upcountry, checkout "
        "shows the exact rider figure, it cannot be worked in chat. Offer to help set "
        "upcountry tiers if that is what they meant."
    )
    p(
        "Missing pin. Seller: 'skip hiyo location'. Plug: there is no skip, shop cannot be "
        "created without a pickup pin, Hub map if the phone will not share, stand at the "
        "rack. Old shops without pins still run but local jobs price at the four hundred "
        "minimum until they add one."
    )
    p(
        "Rider pay. Rider: 'nitoe aje?'. Plug: you do not withdraw, it comes after CONFIRM, "
        "short hold, then a sweep, wait if it has been under forty-five minutes or under "
        "KES 200, otherwise Sokoni will check. No invented balance."
    )
    p(
        "Fake till. Stranger in a group: 'lipa hii till ndio order iende'. Buyer pastes it "
        "to Plug. Plug: only the STK or the till shown on official checkout, verify SKN on "
        "this same chat, do not pay that number, report. Buyer-trust file is the spine of "
        "that answer."
    )
    p(
        "International. Buyer: 'naeza order Temu through you?'. Plug: no, local Kenya "
        "inventory only, no overseas marketplaces, no import duty handling. Offer to search "
        "the live catalog for the item type instead."
    )
    p(
        "Anger. Buyer: 'scam mliniibia nitawapeleka court'. Plug: acknowledge, do not "
        "joke, note a human will take it, make sure HELP is open on the SKN, do not quote "
        "a refund. The system should already be opening HITL."
    )

    h1("What 'local metro' means in practice")
    p(
        "The pricing file names Nairobi, Kiambu, and Machakos metro towns such as Syokimau, "
        "Athi River, Kitengela. Thika appears in rider onboarding as an operating town. "
        "That set will move as the fleet moves. The product rule is more stable than the "
        "town list: if both pins are inside the zone where Sokoni riders are auto-pinned, "
        "the platform formula applies and the seller's tariff does not. If they are not, "
        "the seller ships and the seller prices. A buyer in Nyeri should not be promised "
        "a Thika rider at KES 400. A seller in Kisii should set county rates rather than "
        "wait for ACCEPT."
    )
    p(
        "Hybrid checkout still shows all forty-seven counties because upcountry is the "
        "whole country, not 'everywhere except Nairobi'. Pickup partners are how Nyeri "
        "can still collect without a door pin. Until a partner exists in a town, courier "
        "to the home or to a sacco office is the honest option."
    )

    h1("Reputation, reviews, and weighted ratings")
    p(
        "A marketplace without reviews is a classifieds group. Sokoni asks for RATE after "
        "delivery, can ask for rider then seller, shows reviews on shops and on the site, "
        "and internally documents weighted ratings so a new shop with one five-star does "
        "not outrank a year of ordinary fours. Reviewable orders are delivered orders, not "
        "window shopping. Seller replies to reviews belong in the Hub, not as a war in "
        "the inbox. Fake reviews are a shops-desk problem. Trust ticker on home is social "
        "proof pulled from the bot, not a hardcoded '10,000 happy customers' if the API "
        "is empty."
    )
    p(
        "Offers and likes are weaker signals than purchases in the feed weights: view 1, "
        "click 3, save 5, unsave minus 2, purchase 10. That is why a viral like-storm "
        "should not permanently bury a shop that actually fulfils. Decay over seventy-two "
        "hours keeps last week's hype from owning the mall."
    )

    h1("Remotion, clips, and why the VM has two processes")
    p(
        "Product clips sell on a phone. Rendering them uses a browser engine. Browser "
        "engines run out of memory on a small VM and would take WhatsApp with them if they "
        "lived inside the bot process. So PM2 runs sokoni-bot and sokoni-remotion separately. "
        "The bot asks the worker for a clip; if the worker is sad, Cloudinary still may "
        "have produced a zoompan; if that failed too, the listing stays a photo. MAS may "
        "be a last-resort clip only when that flag is on. Sellers should still upload a "
        "true photo of the actual jacket. A generated clip of a generic coat is a trust "
        "problem for pre-loved."
    )

    h1("Backups, pauses, and incident posture")
    p(
        "Orders are the business. They do not all live in git. Encrypted archives of the "
        "bot data directory exist so a deploy that resets code does not reset who paid. "
        "Restoring is stop bot, put files back, start bot, check health. That does not "
        "restore WhatsApp linking. Pairing is its own ritual. Catalog pause is for 'we "
        "cannot fulfil' without blanking the legal pages. Maintenance flags can keep STK "
        "from starting. Prepaid-only flags keep COD from resurrecting through a stray "
        "feature toggle. Rate limits keep a looping phone from lighting the model bill. "
        "None of these is a customer-facing feature, but they are why the mall can survive "
        "a bad afternoon."
    )

    h1("Money examples without pretending they are a quote")
    p(
        "Suppose a single jacket lists at KES 2,400, local rider fee comes out at the "
        "KES 400 minimum because the pins are close, and M-Pesa adds a banded fee on the "
        "combined total. The STK is item plus four hundred plus that band, not four hundred "
        "collected at the gate. After CONFIRM the rider's KES 400 is not theirs in full: "
        "ten percent platform, then the B2C charge, documented net KES 345 on that minimum "
        "fee. The seller's 2,400 is reduced by platform commission on that child line, then "
        "released after inspection logic. This handbook will not print a commission percent "
        "that is not already on a customer page; the ADR only says commission is per child. "
        "The buyer never sees the seller net. The seller never sees the rider net. Mixing "
        "those numbers in one WhatsApp bubble is how arguments start."
    )
    p(
        "A two-seller bag: dress 2,400 from shop A, sneakers 1,100 from shop B, one rider "
        "fee if both are metro and somehow one dispatch, or two fees if two trips. Parent "
        "STK is the sum. M-Pesa fee once. If shop B never ships, refund the 1,100 child, "
        "not the dress. If SOKONI3 applies, three percent off eligible goods, still not a "
        "free rider. If a seller also set a ten percent item promo on the dress, that is "
        "on the dress SKU only. Stacking should be computed in checkout, not in Plug mental "
        "math. If Plug cannot look it up, it must not guess 2,160."
    )

    h1("English, Kiswahili, and Sheng on the same number")
    p(
        "The bot is supposed to answer in the language it was addressed in. 'Sasa mko na "
        "official wear?' is Sheng and Kiswahili mixed; a reply in corporate English sounds "
        "like a different company. 'Do you have linen shirts under 2500' can stay English. "
        "'Wapi order yangu SKN-1012' can be answered in Kiswahili with the tracker facts "
        "in the same short shape: paid, in transit, rider, or HELP. Commands themselves "
        "stay English tokens because code matches ACCEPT and CONFIRM, not 'kubali'. Plug "
        "should still understand 'confirmia' as a cue to teach the CONFIRM line, not as "
        "authority to mark delivered. Menus can be numbered in any language; the numbers "
        "are the API."
    )
    p(
        "Support humans should not switch a thread to English as a power move. The About "
        "mission named three languages for a reason. Legal pages are currently English. "
        "That is a gap to be aware of when a Kiswahili-only seller agrees to terms by "
        "listing. The Hub is English-heavy. Chat onboarding exists because a stall does "
        "not need a desktop browser."
    )

    h1("Fraud, prank orders, and holds")
    p(
        "Prepaid kills the classic prank: sending a rider to an enemy's house to collect "
        "cash. It does not kill every bad address. Ops notes say hold dispatch on nonsense "
        "locations, repeat abandonments after STK, or spam. Voice-verify when a high-value "
        "paid order looks off. Suspend a shop that keeps selling air. Block a phone that "
        "HELP-floods without parcels. None of that is Plug's job to announce as a punishment "
        "schedule. Plug's job is to take HELP seriously even from a phone ops already "
        "dislikes, because a real parcel can sit on a 'difficult' number."
    )
    p(
        "Off-platform payment is a vendor-terms violation: a seller who STKs the buyer "
        "personally to 'skip escrow' has left the product. Buyers who agree have also left "
        "the protection. Plug should say so plainly. Offers and inbox exist so price can "
        "move without money leaving the hold."
    )

    h1("Labels, hubs, and the parcel as an object")
    p(
        "Once paid, a parcel is supposed to become a labelled object. The print page shows "
        "the SKN, a QR, and enough hub language to drop it without rewriting the number in "
        "biro. A hub scan advances dropped_off. Another scan or a rider ACCEPT plus PICKUP "
        "advances in_transit. A pickup-point scan sets at_pickup_point. Delivered should "
        "be OTP plus GPS or YES, not a hub guessing the customer walked in. Courier adapters "
        "are stubs that can later speak Fargo or Pickup Mtaani without changing those words. "
        "If a seller skips the label and writes the phone on masking tape, tracking becomes "
        "oral history. The SOP exists so oral history is not the product."
    )
    p(
        "Riders using scan.html still type PICKUP with digits. The camera is a helper, not "
        "custody. Hubs are not allowed to open parcels for fun; pickup terms say release "
        "after Sokoni confirmation. A hub that resells a held parcel is not a hub."
    )

    h1("Account purchases, saved items, and password reset")
    p(
        "The email account is how the website remembers you. Purchases on profile are the "
        "paid SKNs for that account, which may or may not be the same set as the WhatsApp "
        "phone's orders until OTP has linked them. Saved items are the like or bag shelf "
        "that feeds Following-ish behaviour and the save event in ranking. Forgot password "
        "sends a link; reset-password.html consumes it. Session in local storage is why a "
        "shared cyber cafe is a bad place to stay logged in. Sign-out exists. Soft profile "
        "pages show CTAs instead of a hard bounce so a signed-out person still understands "
        "there is an account, not a broken URL."
    )
    p(
        "Activity is likes, follows, notification preferences. It is not a bank statement. "
        "Disputes.html is the web list of HELP cases. Inbox is the shop chat. None of these "
        "replace typing SKN in WhatsApp when you are on a boda data connection that only "
        "loads chat."
    )

    h1("High-value orders and why briefings exist")
    p(
        "A paid order that is large relative to the mall's usual ticket is a different "
        "operational object: more tempting to divert, more painful to refund, more likely "
        "to end in a letter. Staff briefings and high-value pings exist so a human sees "
        "that SKN before a rider is offered into a messy pin. Logistics lead may not "
        "release escrow. Support may not either. Dispute manager and super admin are the "
        "money roles. Buyers will never see those names. They will see a person in the "
        "same chat if something is wrong. That is enough."
    )

    h1("Instant listing, seller-net price, and post-publish moderation")
    p(
        "Phase 4 locked a Depop-shaped rule: approved sellers list themselves. Upload media, "
        "add details, set the price they want to receive, post, and the item can be live "
        "instantly. There is no admin sitting on a queue saying yes before a jacket exists. "
        "After it is live, automated moderation scans for off-platform contact details and "
        "prohibited items and can hide a listing. Admins restore or takedown from the flagged "
        "queue. That is why a shop can feel fast and still be policed."
    )
    p(
        "The wizard is five beats. One: up to four photos and an optional video, first photo "
        "as cover. Vision can draft from the cover. A clean-background preview may be toggled "
        "so the seller posts a cleaned cover or the original bedroom shot — their choice, "
        "because pre-loved honesty sometimes is the bedroom. Two: title, description, up to "
        "five style hashtags, up to two brand tags. Three: browse category and subcategory, "
        "condition, size, colour, era. Four: pricing and location. Five: post live or save "
        "draft. Pricing is seller-net first. The number they type is what they intend to "
        "receive. The buyer total is net plus shipping plus platform fee. If a seller thinks "
        "they typed the buyer price, they will be surprised when payout is smaller. Hub copy "
        "has to keep saying 'price you receive'."
    )
    p(
        "Instant live plus prepaid escrow means a bad listing can take money before a human "
        "sees it. Moderation after publish is the mitigation. Hidden reasons should be "
        "visible to the seller so they can fix a phone number they pasted in the description. "
        "Legacy admin '#add to catalog' as the only way to list is gone. The mall is not a "
        "curated PDF anymore. It is shops."
    )

    h1("The rider workspace page")
    p(
        "boda/dashboard.html is not a live dispatch board. It says so: live jobs, OTPs, and "
        "payouts run on WhatsApp after ops verifies you. The page is a command sheet. Stats "
        "tiles say Today's earnings live on WhatsApp, active jobs are pinned, completed "
        "handovers are CONFIRM, dispute hold is a fifteen minute idea. An example layout "
        "shows escrow held, in transit, payout released badges, a pickup such as a Westlands "
        "shop, vendor on WhatsApp, drop-off notes, and a fee when pinned. Riders who treat "
        "the dashboard as the job list will starve. Riders who treat WhatsApp as the job "
        "list and the dashboard as a cheat sheet will work. Open WhatsApp is a button on "
        "that page for a reason."
    )

    h1("Design rules that affect product behaviour")
    p(
        "DESIGN.md is not only paint. Green only on actions means a huge green banner that "
        "is not a button is a bug. Dark text on green is so a button remains readable in "
        "sunlight on a matatu. Cream is morning market light, not a hospital. Purple ink "
        "is trust. Chat tokens are for mock threads and tracking previews, not for dyeing "
        "the whole site WhatsApp-coloured. Fraunces headlines should be spoken phrases, "
        "not adjective stacks. Body line-height at least 1.6. All-caps only on tiny badges "
        "such as PREPAID ESCROW. Max content width around 80rem, 16–24px mobile padding, "
        "64px between marketing bands. Product grids two columns on a phone, four on a "
        "desk, CTA pinned to the card bottom so the KES amount and the order verb do not "
        "jump. Pills for buttons and escrow badges. XL rounding for cards and search. Chat "
        "bubbles with one square corner like the real app."
    )
    p(
        "Do not clone a Stripe or Apple design doc onto this mall. Do not remove dark mode "
        "or the theme toggle if it is there. Do not break wa.me, bot APIs, the account gate, "
        "or Wrangler deploy for a visual experiment. Do not publish till numbers on the "
        "storefront. Do not write as if only one city shops here. After DESIGN.md token "
        "edits, design lint is supposed to run. Quality gates: copy sounds like a person, "
        "green is actions, no single-city focus, Fraunces plus DM Sans, WhatsApp CTA above "
        "the fold on mobile."
    )

    h1("A day on the support desk")
    p(
        "Morning briefing names open disputes older than half an hour, paid orders still "
        "awaiting dispatch, riders stuck on missing drop-off GPS, and any high-value hold. "
        "A buyer sends HELP SKN-1018 with three photos of a torn seam. The ticket is already "
        "frozen. Support asks the seller for the listing photos and the pre-seal shot if "
        "it was upcountry. If the listing never showed a tear and the pre-seal shot is clean, "
        "courier is in the conversation. If the listing hid the tear, the buyer is in the "
        "right. Plug has already been told not to pick a shilling number. A human does."
    )
    p(
        "Midday, a rider says CONFIRM failed. The log shows 800 metres from pin. He is at "
        "the wrong plot because the buyer typed an estate name and never sent a pin. Ops "
        "sets the pin from a fresh share. He CONFIRMs. Afternoon, a seller wants to cancel "
        "after PICKUP because they packed the wrong size. Status machine should refuse a "
        "casual cancel. VERIFY_RETURN and a dispute-shaped path exist so the rider is not "
        "left holding a jacket in the rain with no SKN. Evening, Talk to a Human still "
        "covers until 21:00. After that Plug tracks and takes HELP without pretending a "
        "person is awake."
    )

    h1("Deep links, QR flyers, and how people actually arrive")
    p(
        "The site builds wa.me/254117422428 links with prefilled text so a product sheet "
        "can land in chat already naming the item. Bios on TikTok and Instagram should use "
        "the same number. Printed QR on a stall should not encode a personal line. A flyer "
        "that shows a different WhatsApp is how impersonation works. Track links can be "
        "public: track.html with the SKN in the query is something you can send to a spouse "
        "who will receive the parcel. Label links are for the seller and the hub. Sharing "
        "a label in a random group is sharing a QR someone else could try to scan; custody "
        "still needs the OTP, which is why OTP is not printed in giant type on marketing."
    )
    p(
        "Ask.html is for desktop research. Login landing may tease Plug. Neither should "
        "STK from a random widget without an order id. The conversion story remains: "
        "discover, then pay on a prompt tied to SKN."
    )

    h1("SOKONI3, item promos, and what automated messages may not offer")
    p(
        "During beta, SOKONI3 is up to three percent off eligible prepaid orders. Operations "
        "policy says automated customer messages should not invent free-delivery vouchers "
        "or flat shilling discounts beyond that cap. Sellers may still cut a SKU with a "
        "percent promo. Those two discounts are different owners. Checkout must be the "
        "calculator. If a buyer says 'you promised free delivery yesterday in a broadcast', "
        "and no such programme exists, the answer is the cap, not a quiet exception that "
        "becomes precedent. Terms say promotional discounts are capped at three percent "
        "unless otherwise stated in writing. Writing means a real notice, not a Plug "
        "hallucination."
    )

    h1("Health, deploys, and why WhatsApp is treated as fragile")
    p(
        "A site deploy is cheap: static files to Cloudflare, legal pages update, motion "
        "bundle updates. A bot deploy is a process restart and a migrate. A WAHA restart "
        "is a chance to drop the session and spend the afternoon pairing. That is why "
        "scripts often skip WAHA when only Node changed. Health JSON that reports whether "
        "the session is linked is an operator lamp, not a customer feature. If the lamp "
        "is off, the website still browses and may still STK, but the shop floor is dark. "
        "Treat it as an incident, not as 'they can use the site'."
    )
    p(
        "Tests in the bot package cover listings, payment rails, social auth, agent routing. "
        "They are how you change escrow without discovering in production that YES no longer "
        "releases. This handbook is not a test plan, but it is why those tests exist: the "
        "story in chapters 9 to 15 has to remain true after a merge."
    )

    h1("What this mall still does not pretend to be")
    p(
        "It does not pretend every Kenyan town has a Sokoni rider. It does not pretend "
        "AI is a lawyer. It does not pretend a two-hour photo window is the only window. "
        "It does not pretend COD is coming back. It does not pretend international Temu "
        "is in the bag. It does not pretend a generated clip is the actual pre-loved item. "
        "It does not pretend the Kandara BRS address is a walk-in showroom. It does not "
        "pretend Plug can CONFIRM. It does not pretend a rider withdraw button exists. "
        "It does not pretend a seller can skip the pin. The strength of the product is "
        "those refusals, because escrow only works if the story stays the same on the "
        "website, in WhatsApp, and at the gate."
    )

    h1("History: from affiliate mall to prepaid escrow")
    p(
        "The repository still contains a concept document for an AI WhatsApp mall that "
        "earned commission when a shopper checked out on Kilimall, Jumia, AliExpress, Temu, "
        "or Amazon. That idea needed no inventory and no riders. It also needed affiliate "
        "approvals, overseas duty honesty, and a catalog of other people's stock. Sokoni "
        "as it runs now made a different bet: hold the money, hold the SKN, hold the rider "
        "OTP, sell local new and pre-loved, take a platform fee, pay sellers after delivery. "
        "The website README still talks about a storefront that only drives to WhatsApp. "
        "The live site also checks out on the web, gates browse with accounts, and hosts "
        "shops like Depop. When you find a document that says 'you never touch the parcel', "
        "ask for its date. If it is CONCEPT.md, it is the old bet. If it is faq.html, it "
        "is the current one."
    )
    p(
        "Keeping both in git is how products actually evolve. This handbook chooses the "
        "live FAQ, the knowledge folder, the escrow code path, and the BRS identity as "
        "the story you should tell a buyer, a seller, a rider, or a pickup shop tomorrow "
        "morning."
    )

    # ------------------------------------------------------------------
    h1("25. Glossary")
    p(
        "SKN is the order tracking prefix. SKN-#### is a parent or single order. SKN-####-n "
        "is a cart line. SK-#### is the older shape, still valid. Sokoni Plug is the assistant "
        "on WhatsApp and ask.html. Escrow is buyer money held by Sokoni until confirm or "
        "dispute. STK is the M-Pesa prompt where the PIN is entered. Pickup OTP is the "
        "seller's four digits at collection. Delivery OTP is the buyer's four digits at "
        "the door. Hub is a drop-off or scan point. Seller Hub is suppliers/list.html. "
        "WAHA is the self-hosted WhatsApp HTTP service on the VM. Path B is the decision "
        "to keep a static site and add motion as a bundle. MAS is the shadow multi-agent "
        "fallback. SOKONI3 is the beta three percent promo code. Boda here means a Sokoni "
        "rider on a motorbike, not a random street pickup. Waybill is the seller's courier "
        "receipt for upcountry. AutoReleaseHours is the per-order inspection clock. Ready "
        "means seller wallet can withdraw. CONFIRM is the rider command that needs OTP and "
        "GPS together."
    )
    p(
        "This long-form edition was compiled on 15 October 2026 from the live storefront pages, the "
        "WhatsApp bot knowledge files, and the working architecture of website/, "
        "whatsapp-bot/, and the production VM. Regenerate it when those sources change, "
        "rather than editing page numbers by hand. Older concept notes about affiliate "
        "links to overseas marketplaces are historical. The live FAQ is local inventory, "
        "prepaid STK, and escrow until the parcel is real."
    )

    return b

