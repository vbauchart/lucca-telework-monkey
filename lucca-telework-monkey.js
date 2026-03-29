// ==UserScript==
// @name         Lucca – Télétravail automatique
// @namespace    https://*.ilucca.net/
// @version      1.0
// @description  Saisit automatiquement les jours de télétravail via le module Absences de Lucca.
//               Basé sur le reverse-engineering du endpoint leaveRequestFactory/create.
// @author       Vincent
// @match        https://*.ilucca.net/timmi-absences/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  //  CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════
  const CONFIG = {
    // Jours de télétravail : 0=Lun, 1=Mar, 2=Mer, 3=Jeu, 4=Ven
    teleworkDays: [1, 4],   // Mardi + Vendredi

    // Nombre de semaines à remplir en avant et en arrière depuis la semaine en cours
    weeksAhead: 4,
    weeksBefore: 4,

    // ID du compte d'absence "Télétravail"
    leaveAccountId: 29,
    leaveAccountName: 'Télétravail',
    leaveAccountColor: '#FFC61A',

    // Endpoint de création
    endpoint: '/timmi-absences/api/v1.0/leaveRequestFactory/create',
  };
  // ═══════════════════════════════════════════════════════════════════

  // ───────────────────────────────────────────────────────────────────
  //  HELPERS
  // ───────────────────────────────────────────────────────────────────
  // Formate en YYYY-MM-DD en heure locale (fr-CA produit ce format nativement)
  const toDateStr = (d) => d.toLocaleDateString('fr-CA');

  async function apiGet(path) {
    const res = await fetch(path, { credentials: 'include' });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST ${path} → ${res.status}\n${text}`);
    }
    return res.json();
  }

  // ───────────────────────────────────────────────────────────────────
  //  CONSTRUCTION DES DATES CIBLES
  // ───────────────────────────────────────────────────────────────────
  function buildTargetDates() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dow = today.getDay(); // 0=dim, 1=lun ... 6=sam
    const offsetToMonday = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setDate(today.getDate() + offsetToMonday);

    // Lundi de départ : weeksBefore semaines en arrière
    const startMonday = new Date(monday);
    startMonday.setDate(monday.getDate() - CONFIG.weeksBefore * 7);

    const totalWeeks = CONFIG.weeksBefore + CONFIG.weeksAhead + 1;
    const result = [];
    for (let w = 0; w < totalWeeks; w++) {
      for (const day of CONFIG.teleworkDays) {
        // day est l'offset depuis lundi : 0=lun, 1=mar, 2=mer, 3=jeu, 4=ven
        const d = new Date(startMonday);
        d.setDate(startMonday.getDate() + w * 7 + day);
        result.push(d); // inclut passé (retard géré dans le payload) et futur
      }
    }
    return result.sort((a, b) => a - b);
  }

  // ───────────────────────────────────────────────────────────────────
  //  DÉDOUBLONNAGE via leaveCalendar
  //  Utilise le même endpoint que l'app Angular pour récupérer
  //  les périodes d'absence déjà saisies sur une plage de dates.
  // ───────────────────────────────────────────────────────────────────
  async function getExistingTeleworkDates(userId, dateStart, dateEnd) {
    // leaveCalendar fonctionne mois par mois, on itère si besoin
    const months = new Set();
    const d = new Date(dateStart);
    while (d <= dateEnd) {
      months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
      d.setMonth(d.getMonth() + 1);
    }

    const teleworkDates = new Set();
    for (const monthStart of months) {
      try {
        const json = await apiGet(
          `/api/v3/services/leaveCalendar/${userId}` +
          `?startsOn=${monthStart}&endsOn=${monthStart}&multicolor=true`
        );
        for (const period of json.periods ?? []) {
          if (period.accountNames?.includes(CONFIG.leaveAccountName)) {
            // Une période peut couvrir plusieurs jours (startsOn → endsOn)
            const start = new Date(period.startsOn);
            const end = new Date(period.endsOn);
            const cur = new Date(start);
            while (cur <= end) {
              teleworkDates.add(toDateStr(cur));
              cur.setDate(cur.getDate() + 1);
            }
          }
        }
      } catch (e) {
        console.warn(`[Lucca TT] leaveCalendar erreur pour ${monthStart} :`, e.message);
      }
    }
    return teleworkDates;
  }

  // ───────────────────────────────────────────────────────────────────
  //  CONSTRUCTION DU PAYLOAD
  //  Reproduit fidèlement le format observé dans le HAR.
  //  Pour les dates futures, warnings = [] (pas de retard).
  // ───────────────────────────────────────────────────────────────────
  function buildPayload(ownerId, ownerName, date) {
    const dateStr = toDateStr(date);
    const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));

    return {
      daysUnit: false,
      warnings: isPast
        ? [{
            ruleId: 1,
            description: 'La demande est faite en retard. Souhaitez-vous continuer malgré tout ?',
            error: false,
            info: false,
            concernedUsers: [],
          }]
        : [],
      agreementWarnings: [],
      balanceEstimateEndsOn: '0001-01-01T00:00:00',
      accounts: [
        {
          leaveAccountId: CONFIG.leaveAccountId,
          leaveAccountName: CONFIG.leaveAccountName,
          i18nLabels: [],
          leaveAccountColor: CONFIG.leaveAccountColor,
          categoryType: '',
          categoryValue: '',
          consumptionEndDate: null,
          unit: 0,
          duration: 1,
          autoCredit: true,
          constraint: {
            maxValue: null,
            warnings: [],
            currentBalance: null,
            leavePeriodEndDateBalance: 0,
            entitlementEndDateBalance: null,
            entitlementEndDateEntitlement: null,
            entitlementEndDateConsumption: null,
            allowSelect: null,
            consumptionStartDate: null,
            consumptionEndDate: null,
            debitAuthorization: null,
            halfDayAuthorization: null,
            allowOuterConsumption: 0,
            allowHalfDay: true,
            durationHour: 0,
            stepHour: 0.5,
            completeConsumption: null,
            leaveAccountForbiddenPeriodMessage: '',
            leaveAccountForbiddenPeriodStartDate: null,
            leaveAccountForbiddenPeriodEndDate: null,
          },
        },
      ],
      daysOff: {
        sunday: null, monday: null, tuesday: null,
        wednesday: null, thursday: null, friday: null, saturday: null,
      },
      unlimitedDaysOffCalculation: true,
      duration: 1,
      isValid: true,
      areSupportingDocumentsManaged: false,
      withCandidate: false,
      ownerId,
      ownerName,
      startsOn: dateStr,
      startsAM: true,
      endsOn: dateStr,
      endsAM: false,      // journée complète = AM start + PM end
      isHalfDay: false,
      unit: 0,
      autoCreate: false,  // le serveur le passe à true et crée la demande
      comments: '',
      chosenApproverIds: [],
      nextApprover: null,
    };
  }

  // ───────────────────────────────────────────────────────────────────
  //  FLOW PRINCIPAL
  // ───────────────────────────────────────────────────────────────────
  async function run() {
    const btn = document.getElementById('tt-auto-btn');
    setBtn(btn, true, '⏳ Chargement…');

    try {
      // 1. Infos utilisateur
      const me = await apiGet('/api/v3/users/me?fields=id,firstName,lastName');
      const userId = me.data.id;
      const ownerName = `${me.data.lastName} ${me.data.firstName}`;

      // 2. Dates cibles
      const targetDates = buildTargetDates();
      if (!targetDates.length) { alert('Aucune date à créer.'); return; }

      // 3. Dédoublonnage
      setBtn(btn, true, '⏳ Vérification…');
      const existing = await getExistingTeleworkDates(
        userId, targetDates[0], targetDates[targetDates.length - 1]
      );
      const toCreate = targetDates.filter((d) => !existing.has(toDateStr(d)));

      if (!toCreate.length) {
        alert('✅ Tout est déjà saisi — rien à créer !');
        return;
      }

      // 4. Confirmation
      const confirmed = window.confirm(
        `🏠 Créer ${toCreate.length} jour(s) de télétravail ?\n\n` +
        toCreate.map((d) =>
          `  • ${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
        ).join('\n')
      );
      if (!confirmed) return;

      // 5. Création
      let created = 0;
      const errors = [];
      for (const date of toCreate) {
        try {
          const payload = buildPayload(userId, ownerName, date);
          await apiPost(CONFIG.endpoint, payload);
          created++;
          setBtn(btn, true, `⏳ ${created}/${toCreate.length}`);
          await new Promise((r) => setTimeout(r, 400)); // délai courtois
        } catch (e) {
          errors.push(`${toDateStr(date)} : ${e.message}`);
          console.error('[Lucca TT] Erreur création', toDateStr(date), e);
        }
      }

      if (errors.length) {
        alert(`⚠️ ${created} créé(s), ${errors.length} erreur(s) :\n\n${errors.join('\n')}`);
      } else {
        alert(`✅ ${created} jour(s) de télétravail créé(s) !`);
      }

    } catch (err) {
      console.error('[Lucca TT]', err);
      alert(`❌ Erreur :\n\n${err.message}`);
    } finally {
      setBtn(btn, false, '🏠 Remplir télétravail');
    }
  }

  // ───────────────────────────────────────────────────────────────────
  //  UI
  // ───────────────────────────────────────────────────────────────────
  function setBtn(btn, disabled, label) {
    if (!btn) return;
    btn.disabled = disabled;
    btn.textContent = label;
    btn.style.opacity = disabled ? '0.7' : '1';
  }

  function injectUI() {
    if (document.getElementById('tt-auto-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'tt-auto-btn';
    btn.textContent = '🏠 Remplir télétravail';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '99999',
      padding: '10px 18px',
      background: '#4f46e5',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      fontFamily: 'sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      transition: 'opacity 0.15s, transform 0.1s',
    });
    btn.addEventListener('mouseenter', () => !btn.disabled && (btn.style.transform = 'scale(1.03)'));
    btn.addEventListener('mouseleave', () => (btn.style.transform = 'scale(1)'));
    btn.addEventListener('click', run);
    document.body.appendChild(btn);
  }

  const observer = new MutationObserver(() => { if (document.body) injectUI(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.body) injectUI();

})();
