/* =========================================================================
   Wrbet Kenya — prototype renderer
   The same wireframe content for every device; layout comes from
   wireframe.css via body[data-device]. Keeps the three prototypes in sync.
   ========================================================================= */
(function () {
  'use strict';

  var DEVICE = document.body.getAttribute('data-device') || 'mobile';

  var META = {
    mobile:  { label: 'Mobile',  width: '390px',  cols: '1 column · stacked · burger menu' },
    tablet:  { label: 'Tablet',  width: '834px',  cols: '2 columns · inline nav · taller banners' },
    desktop: { label: 'Desktop', width: '1440px', cols: '3–4 columns · split hero · full nav + CTA' }
  }[DEVICE];

  function lines(n, mod) {
    var out = '';
    for (var i = 0; i < n; i++) out += '<i></i>';
    return '<div class="lines' + (mod ? ' ' + mod : '') + '">' + out + '</div>';
  }

  function ph(text, cls) {
    return '<div class="ph ' + (cls || '') + '">' + text + '</div>';
  }

  function card(title, iconMod) {
    return '<article class="wf-card">' +
      '<div class="wf-card__icon ' + (iconMod || '') + '"></div>' +
      '<h3 class="wf-h3">' + title + '</h3>' +
      lines(2, 'lines--short') +
    '</article>';
  }

  function imgCard(title) {
    return '<article class="wf-card wf-card--img">' +
      ph('image') +
      '<div class="wf-card__body"><h3 class="wf-h3">' + title + '</h3>' + lines(2, 'lines--short') + '</div>' +
    '</article>';
  }

  var SPORTS = ['Live Betting', 'Pre-Match Betting', 'Esports Betting', 'Sports Calendar', 'Results & Stats', 'Betting Slip Basics'];
  var CASINO = ['Live Casino', 'Crash Games', 'Bonuses', 'Casino Tournaments'];
  var WHY = ['Sports Betting', 'Online Casino', 'Live Casino', 'Crash Games', 'Virtual Sports', 'Bonuses', 'Responsible Gambling'];
  var NAV = ['Sports Betting', 'Online Casino', 'Aviator', 'Guide', 'FAQ'];
  var FAQ = 9;

  var faqItems = '<div class="wf-faq__item wf-faq__item--open">' +
      '<div class="wf-faq__row"><b>Question 1 — expanded state</b><span>−</span></div>' +
      lines(3) +
    '</div>';
  for (var q = 2; q <= FAQ; q++) {
    faqItems += '<div class="wf-faq__item"><b>Question ' + q + '</b><span>+</span></div>';
  }

  var html =
  '<div class="wf-page">' +

    '<div class="wf-tag">' +
      '<b>' + META.label + '</b><span>·</span>' + META.width + '<span>·</span>' + META.cols +
    '</div>' +
    '<div class="wf-note">Wireframe prototype — structure and hierarchy only. Colour, imagery and copy land in the production build.</div>' +

    /* header */
    '<header class="wf-header">' +
      '<div class="wf-brand">' +
        '<div class="wf-brand__mark">W</div>' +
        '<div><div class="wf-brand__name">Wrbet</div><div class="wf-brand__sub">KENYA</div></div>' +
      '</div>' +
      '<nav class="wf-nav">' + NAV.map(function (n) { return '<a>' + n + '</a>'; }).join('') + '</nav>' +
      '<a class="wf-btn wf-header__cta">Explore the guide</a>' +
      '<div class="wf-burger"><i></i><i></i><i></i></div>' +
    '</header>' +

    /* hero */
    '<section class="wf-hero">' +
      '<div class="wf-hero__copy">' +
        '<span class="wf-anno">H1 · hero</span>' +
        '<h1 class="wf-h1">Wrbet Kenya Betting Guide</h1>' +
        lines(4) +
        lines(3) +
        '<div class="wf-hero__actions">' +
          '<a class="wf-btn">Learn More</a>' +
          '<a class="wf-btn wf-btn--ghost">Responsible gambling</a>' +
        '</div>' +
      '</div>' +
      ph('hero banner<br>' + (DEVICE === 'desktop' ? 'side visual' : 'full width'), 'wf-hero__banner') +
    '</section>' +

    /* sports */
    '<section class="wf-sec">' +
      '<div class="wf-sec__head">' +
        '<span class="wf-anno">Section 01 · ' + (DEVICE === 'mobile' ? '1 col' : DEVICE === 'tablet' ? '2 cols' : '3 cols') + '</span>' +
        '<h2 class="wf-h2">Sports Betting</h2>' +
      '</div>' +
      ph('section banner', 'wf-banner') +
      '<div class="wf-split">' +
        '<div>' + lines(6) + lines(5) + '</div>' +
        '<aside class="wf-aside"><h3 class="wf-h3">Odds explainer</h3>' + lines(5) + '</aside>' +
      '</div>' +
      '<div class="wf-grid wf-grid--sports">' + SPORTS.map(function (t) { return card(t); }).join('') + '</div>' +
    '</section>' +

    /* casino */
    '<section class="wf-sec">' +
      '<div class="wf-sec__head">' +
        '<span class="wf-anno">Section 02 · ' + (DEVICE === 'desktop' ? '4 cols' : DEVICE === 'tablet' ? '2 cols' : '1 col') + '</span>' +
        '<h2 class="wf-h2">Online Casino</h2>' +
      '</div>' +
      ph('section banner', 'wf-banner') +
      '<div class="wf-split">' +
        '<div>' + lines(6) + lines(4) + '</div>' +
        '<aside class="wf-aside"><h3 class="wf-h3">RTP comparison</h3>' + lines(5) + '</aside>' +
      '</div>' +
      '<div class="wf-grid wf-grid--casino">' + CASINO.map(function (t) { return card(t, 'wf-card__icon--round'); }).join('') + '</div>' +
    '</section>' +

    /* aviator */
    '<section class="wf-sec">' +
      '<div class="wf-aviator">' +
        '<div class="wf-aviator__copy">' +
          '<span class="wf-anno">Section 03 · feature block</span>' +
          '<h2 class="wf-h2">Aviator Game</h2>' +
          lines(5) +
          '<div>' + lines(2, 'lines--short') + '</div>' +
          '<a class="wf-btn">Learn More</a>' +
        '</div>' +
        ph('aviator visual', 'wf-aviator__banner') +
      '</div>' +
    '</section>' +

    /* why */
    '<section class="wf-sec">' +
      '<div class="wf-sec__head">' +
        '<span class="wf-anno">Section 04 · ' + (DEVICE === 'desktop' ? 'bento, first card 2× wide' : DEVICE === 'tablet' ? '2 cols, last card full width' : '1 col') + '</span>' +
        '<h2 class="wf-h2">Why Players Explore Wrbet</h2>' +
        lines(2, 'lines--short') +
      '</div>' +
      '<div class="wf-grid wf-grid--why">' + WHY.map(function (t) { return imgCard(t); }).join('') + '</div>' +
    '</section>' +

    /* responsible */
    '<section class="wf-sec">' +
      '<div class="wf-dark">' +
        '<div>' +
          '<h2 class="wf-h2">Responsible Gambling</h2>' +
          '<div style="margin:16px 0 22px">' + lines(5) + '</div>' +
          '<a class="wf-btn">Learn More</a>' +
        '</div>' +
        '<div>' + lines(6) + '</div>' +
      '</div>' +
    '</section>' +

    /* faq */
    '<section class="wf-sec">' +
      '<div class="wf-faq">' +
        '<div class="wf-sec__head" style="margin:0">' +
          '<span class="wf-anno">Section 05 · accordion ×' + FAQ + '</span>' +
          '<h2 class="wf-h2">Frequently Asked Questions</h2>' +
        '</div>' +
        '<div class="wf-faq__list">' + faqItems + '</div>' +
      '</div>' +
    '</section>' +

    /* footer */
    '<footer class="wf-footer">' +
      '<div class="wf-footer__cols">' +
        '<div class="wf-footer__col wf-footer__brand">' +
          '<div class="wf-brand">' +
            '<div class="wf-brand__mark">W</div>' +
            '<div><div class="wf-brand__name">Wrbet</div><div class="wf-brand__sub">KENYA</div></div>' +
          '</div>' +
          lines(3, 'lines--short') +
        '</div>' +
        '<div class="wf-footer__col"><div class="wf-footer__heading">Guide</div>' + lines(4) + '</div>' +
        '<div class="wf-footer__col"><div class="wf-footer__heading">Learn</div>' + lines(4) + '</div>' +
        '<div class="wf-footer__col"><div class="wf-footer__heading">About</div>' + lines(4) + '</div>' +
      '</div>' +
      '<div class="wf-footer__links">' +
        ['Sports Betting', 'Online Casino', 'Bonuses', 'FAQ', 'Responsible Gambling', 'About', 'Contact']
          .map(function (l) { return '<a>' + l + '</a>'; }).join('') +
      '</div>' +
      '<p class="wf-fineprint">18+. Gambling can be addictive — please play responsibly. This guide is intended for ' +
      'informational purposes for players in Kenya and does not itself accept bets or wagers.</p>' +
    '</footer>' +

  '</div>';

  document.body.insertAdjacentHTML('beforeend', html);
})();
