// Single source of truth for the ten approved marketing category definitions.
// Used by the in-memory store seed and by the PostgreSQL taxonomy seed, so both
// drivers start from exactly the same approved taxonomy.
const definitions = [
  ['Digital Advertising', ['Meta Ads', 'Google Ads', 'TikTok Ads', 'Display Advertising']],
  ['Events & Sponsorships', ['Seminars', 'Conferences', 'Exhibitions', 'Event Sponsorships']],
  ['Podcast Marketing', ['Podcast Ads', 'Podcast Sponsorships']],
  ['Influencer Marketing', ['Influencer Payments', 'YouTube Promotions', 'Affiliate Marketing']],
  ['Printing & Branding', ['Banners', 'Brochures', 'Printing', 'Outdoor Advertising']],
  ['SEO & Website', ['SEO Services', 'Website Marketing', 'Landing Pages']],
  ['Salaries & Wages', ['Marketing Salaries', 'Daily Wages']],
  ['Marketing Tools', ['ChatGPT', 'Semrush', 'Cloud Tools', 'Other Subscriptions']],
  ['Creative Production', ['Graphic Design', 'Video Production', 'Photography', 'Copywriting']],
  ['Other Marketing', ['Custom Expense']],
];
module.exports = { definitions };
