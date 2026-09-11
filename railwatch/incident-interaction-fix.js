(() => {
  const feed = document.getElementById('alert-feed');
  const apiBase = (new URLSearchParams(location.search).get('api') || 'https://naha-railwatch-api.onrender.com').replace(/\/$/, '');
  if (!feed) return;

  function escape(value) {
    return String(value ?? '').replace(/[&<>\'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function wireAlertCards() {
    feed.querySelectorAll('.alert').forEach(row => {
      row.style.cursor = 'pointer';
      row.title = 'Open incident details';
      if (row.dataset.interactionWired) return;
      row.dataset.interactionWired = 'true';
      row.addEventListener('click', async () => {
        const strong = row.querySelector('strong')?.textContent || '';
        const span = row.querySelector('span')?.textContent || '';
        const kmMatch = strong.match(/KM\s+([0-9.]+)/i);
        const sensorMatch = span.match(/·\s*([^·]+)$/);
        try {
          const response = await fetch(`${apiBase}/api/v1/events?limit=20`);
          if (!response.ok) throw new Error('Event lookup failed');
          const events = await response.json();
          const match = [...events].reverse().find(item => {
            const data = item?.data;
            return data && String(data.segment || '').includes(strong.split(' · KM ')[0])
              && Number(data.km_marker || 0).toFixed(1) === (kmMatch?.[1] || '')
              && (!sensorMatch || String(data.sensor_id || '') === sensorMatch[1].trim());
          })?.data;
          if (match && typeof showIncident === 'function') showIncident(match);
        } catch (error) {
          console.debug('Incident selection unavailable', error);
        }
      });
    });
  }

  async function hydrateHistory() {
    try {
      const response = await fetch(`${apiBase}/api/v1/events?limit=20`);
      if (!response.ok) return;
      const events = await response.json();
      const history = window.RailWatchHistory;
      if (!history?.record) return;
      [...events].reverse().forEach(item => {
        if (item?.data) history.record(item.data);
      });
    } catch (error) {
      console.debug('Incident history hydration unavailable', error);
    }
  }

  const observer = new MutationObserver(() => wireAlertCards());
  observer.observe(feed, { childList: true, subtree: true });
  wireAlertCards();

  document.addEventListener('railwatch:incident', () => {
    setTimeout(hydrateHistory, 250);
    setTimeout(hydrateHistory, 900);
  });

  hydrateHistory();
})();
