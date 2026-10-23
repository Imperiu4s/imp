// Search engines available in Imp. Shared by the main process and pages.
(function (root) {
  const ENGINES = {
    duckduckgo: {
      name: 'DuckDuckGo',
      search: 'https://duckduckgo.com/?q=%s',
      suggest: 'https://duckduckgo.com/ac/?q=%s&type=list',
      color: '#DE5833',
    },
    google: {
      name: 'Google',
      search: 'https://www.google.com/search?q=%s',
      suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s',
      color: '#4285F4',
    },
    brave: {
      name: 'Brave Search',
      search: 'https://search.brave.com/search?q=%s',
      suggest: 'https://search.brave.com/api/suggest?q=%s',
      color: '#FB542B',
    },
    bing: {
      name: 'Bing',
      search: 'https://www.bing.com/search?q=%s',
      suggest: 'https://api.bing.com/osjson.aspx?query=%s',
      color: '#008373',
    },
    startpage: {
      name: 'Startpage',
      search: 'https://www.startpage.com/sp/search?query=%s',
      suggest: null,
      color: '#6573FF',
    },
    ecosia: {
      name: 'Ecosia',
      search: 'https://www.ecosia.org/search?q=%s',
      suggest: 'https://ac.ecosia.org/autocomplete?q=%s&type=list',
      color: '#36ACB8',
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ENGINES;
  else root.ImpEngines = ENGINES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
