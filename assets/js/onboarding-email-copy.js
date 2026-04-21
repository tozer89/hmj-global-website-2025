(function onboardingEmailCopyModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HMJOnboardingEmailCopy = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildOnboardingEmailCopy() {
  const DEFAULT_CONFIRMATION_LANGUAGE = 'en';
  const GENERAL_SUPPORT_EMAIL = 'info@hmj-global.com';
  const ACCOUNTS_SUPPORT_EMAIL = 'accounts@hmj-global.com';
  const LANGUAGE_OPTIONS = [
    { value: 'en', label: 'English' },
    { value: 'ro', label: 'Romanian' },
    { value: 'lt', label: 'Lithuanian' },
    { value: 'de', label: 'German' },
    { value: 'es', label: 'Spanish' },
  ];

  function trimString(value, maxLength) {
    const text = typeof value === 'string'
      ? value.trim()
      : String(value == null ? '' : value).trim();
    if (!text) return '';
    if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
    return text.slice(0, maxLength);
  }

  function normaliseConfirmationLanguage(value) {
    const requested = trimString(value, 12).toLowerCase();
    return LANGUAGE_OPTIONS.some((option) => option.value === requested)
      ? requested
      : DEFAULT_CONFIRMATION_LANGUAGE;
  }

  function languageLabel(value) {
    const key = normaliseConfirmationLanguage(value);
    return LANGUAGE_OPTIONS.find((option) => option.value === key)?.label || 'English';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildPlacementContext(company, projectLocation, language) {
    const lang = normaliseConfirmationLanguage(language);
    const clientName = trimString(company, 180) || 'your new client';
    const location = trimString(projectLocation, 180);
    if (!location) return clientName;
    if (lang === 'ro') return `${clientName} la ${location}`;
    if (lang === 'lt') return `${clientName} projekte ${location}`;
    if (lang === 'de') return `${clientName} in ${location}`;
    if (lang === 'es') return `${clientName} en ${location}`;
    return `${clientName} on ${location}`;
  }

  function buildConfirmationContext(input = {}, options = {}) {
    const language = normaliseConfirmationLanguage(options.language || input.language);
    const firstName = trimString(input.firstName != null ? input.firstName : input.first_name, 120) || 'there';
    const lastName = trimString(input.lastName != null ? input.lastName : input.last_name, 120);
    const fullName = trimString(
      input.fullName
      || input.full_name
      || [firstName, lastName].filter(Boolean).join(' '),
      240,
    ) || firstName;
    const companyName = trimString(input.companyName || input.company || input.company_name || input.client_name, 180) || 'your new client';
    const projectLocation = trimString(input.projectLocation || input.project_location, 180);
    const supportEmail = trimString(input.supportEmail || input.support_email, 320) || GENERAL_SUPPORT_EMAIL;
    const infoEmail = trimString(input.infoEmail || input.info_email, 320) || GENERAL_SUPPORT_EMAIL;
    const accountsEmail = trimString(input.accountsEmail || input.accounts_email, 320) || ACCOUNTS_SUPPORT_EMAIL;
    return {
      language,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      company_name: companyName,
      client_name: companyName,
      project_location: projectLocation,
      placement_context: buildPlacementContext(companyName, projectLocation, language),
      support_email: supportEmail,
      info_email: infoEmail,
      accounts_email: accountsEmail,
    };
  }

  const CONFIRMATION_TEMPLATES = {
    en: {
      subject: 'Welcome to HMJ Global - your onboarding details for <COMPANY_NAME>',
      heading: 'Welcome to HMJ Global',
      intro: 'Review your HMJ timesheet, payment and support details before you start with <PLACEMENT_CONTEXT>.',
      contextNote: 'Keep this onboarding summary for reference and use the HMJ button below whenever you need Timesheet Portal access.',
      actionLabel: 'Open HMJ timesheets / portal access',
      body: [
        'Hi <FIRST_NAME>,',
        '',
        'Welcome to HMJ Global, and congratulations on securing your role with <PLACEMENT_CONTEXT>.',
        '',
        "We're pleased to have you on board. Before you start, please take a few moments to review the information below and confirm everything is in order.",
        '',
        '1. Timesheet Portal - Login Check (Important)',
        'You should have received an email to set up your Timesheet Portal login.',
        '- Please log in and ensure you have access.',
        '- Check your details are correct.',
        '- If you have not received this email, please let us know as soon as possible and we will resend it.',
        '',
        '2. Timesheet & Payment Process',
        'Your timesheet is completed online each week.',
        '- Your e-timesheet is released in the early hours of Monday and relates to the working week ahead.',
        '- Enter your hours directly into the system during the week - there is no need to send anything back.',
        '- Please ensure your timesheet is fully completed by the end of the working week.',
        'Payments are typically processed on the following Wednesday, subject to timesheet approval and submission within the required timeframe.',
        '',
        '3. Contact & Support',
        'If you need any help at any stage, you can contact us:',
        '- Timesheet or general queries - <INFO_EMAIL>',
        '- Payment queries or bank detail updates - <ACCOUNTS_EMAIL>',
        'We aim to respond quickly and resolve any issues without delay.',
        '',
        '4. Onboarding & Next Steps',
        'Your contract will be issued separately via email.',
        '- Please review, sign, and return it promptly to avoid any delays in onboarding and payment setup.',
        'If you have any questions at all, just reach out.',
        '',
        'Welcome onboard - we look forward to working with you.',
        '',
        'Best regards,',
        '',
        'HMJ Global Team',
      ].join('\n'),
    },
    ro: {
      subject: 'Bine ați venit la HMJ Global - detaliile dumneavoastră de onboarding pentru <COMPANY_NAME>',
      heading: 'Bine ați venit la HMJ Global',
      intro: 'Consultați detaliile HMJ privind pontajul, plata și suportul înainte de a începe cu <PLACEMENT_CONTEXT>.',
      contextNote: 'Păstrați acest rezumat de onboarding pentru referință și folosiți butonul HMJ de mai jos ori de câte ori aveți nevoie de acces la Timesheet Portal.',
      actionLabel: 'Deschideți accesul HMJ la pontaj / portal',
      body: [
        'Bună <FIRST_NAME>,',
        '',
        'Bine ați venit la HMJ Global și felicitări pentru rolul obținut la <PLACEMENT_CONTEXT>.',
        '',
        'Ne bucurăm să vă avem alături. Înainte de a începe, vă rugăm să acordați câteva momente pentru a consulta informațiile de mai jos și pentru a confirma că totul este în regulă.',
        '',
        '1. Timesheet Portal - verificarea autentificării (Important)',
        'Ar fi trebuit să primiți un e-mail pentru configurarea autentificării în Timesheet Portal.',
        '- Vă rugăm să vă conectați și să verificați că aveți acces.',
        '- Verificați dacă datele dumneavoastră sunt corecte.',
        '- Dacă nu ați primit acest e-mail, anunțați-ne cât mai curând posibil și îl vom retrimite.',
        '',
        '2. Procesul de pontaj și plată',
        'Pontajul dumneavoastră se completează online în fiecare săptămână.',
        '- E-timesheet-ul este emis în primele ore ale zilei de luni și se referă la săptămâna de lucru care urmează.',
        '- Introduceți orele direct în sistem pe parcursul săptămânii - nu este nevoie să trimiteți nimic înapoi.',
        '- Vă rugăm să vă asigurați că pontajul este completat integral până la sfârșitul săptămânii de lucru.',
        'Plățile sunt procesate, de regulă, în ziua de miercuri a săptămânii următoare, în funcție de aprobarea pontajului și de transmiterea acestuia în intervalul necesar.',
        '',
        '3. Contact și suport',
        'Dacă aveți nevoie de ajutor în orice etapă, ne puteți contacta:',
        '- Întrebări despre pontaj sau solicitări generale - <INFO_EMAIL>',
        '- Întrebări despre plăți sau actualizarea datelor bancare - <ACCOUNTS_EMAIL>',
        'Ne propunem să răspundem rapid și să rezolvăm orice problemă fără întârziere.',
        '',
        '4. Administrare onboarding și pașii următori',
        'Contractul dumneavoastră va fi trimis separat prin e-mail.',
        '- Vă rugăm să îl citiți, să îl semnați și să îl returnați prompt pentru a evita orice întârziere în onboarding și în configurarea plății.',
        'Dacă aveți întrebări, vă rugăm doar să ne contactați.',
        '',
        'Bine ați venit la bord - așteptăm cu plăcere să lucrăm împreună.',
        '',
        'Best regards,',
        '',
        'HMJ Global Team',
      ].join('\n'),
    },
    lt: {
      subject: 'Sveiki atvykę į HMJ Global - jūsų įdarbinimo pradžios informacija darbui su <COMPANY_NAME>',
      heading: 'Sveiki atvykę į HMJ Global',
      intro: 'Prieš pradėdami darbą su <PLACEMENT_CONTEXT>, peržiūrėkite HMJ darbo laiko apskaitos, apmokėjimo ir pagalbos informaciją.',
      contextNote: 'Išsaugokite šią įvedimo santrauką ir naudokite toliau pateiktą HMJ mygtuką, kai tik prireiks prieigos prie Timesheet Portal.',
      actionLabel: 'Atidaryti HMJ darbo laiko / portalo prieigą',
      body: [
        'Sveiki <FIRST_NAME>,',
        '',
        'Sveiki atvykę į HMJ Global ir sveikiname gavus pareigas įmonėje <PLACEMENT_CONTEXT>.',
        '',
        'Džiaugiamės galėdami jus priimti į komandą. Prieš pradėdami, skirkite kelias minutes toliau pateiktai informacijai peržiūrėti ir patvirtinkite, kad viskas tvarkoje.',
        '',
        '1. Timesheet Portal - prisijungimo patikra (Svarbu)',
        'Turėjote gauti el. laišką, skirtą susikurti prisijungimą prie Timesheet Portal.',
        '- Prisijunkite ir įsitikinkite, kad turite prieigą.',
        '- Patikrinkite, ar jūsų duomenys yra teisingi.',
        '- Jei šio el. laiško negavote, kuo greičiau praneškite mums ir mes jį išsiųsime dar kartą.',
        '',
        '2. Darbo laiko apskaitos ir apmokėjimo procesas',
        'Jūsų darbo laiko žiniaraštis kiekvieną savaitę pildomas internetu.',
        '- Jūsų e-timesheet pateikiamas pirmosiomis pirmadienio valandomis ir yra skirtas būsimai darbo savaitei.',
        '- Savo valandas įveskite tiesiai į sistemą savaitės eigoje - nieko papildomai siųsti nereikia.',
        '- Įsitikinkite, kad darbo laiko žiniaraštis yra visiškai užpildytas iki darbo savaitės pabaigos.',
        'Apmokėjimai paprastai atliekami kitą trečiadienį, jei darbo laiko žiniaraštis buvo patvirtintas ir pateiktas laiku.',
        '',
        '3. Kontaktai ir pagalba',
        'Jei bet kuriame etape prireiktų pagalbos, galite susisiekti su mumis:',
        '- Klausimai dėl darbo laiko apskaitos ar bendros užklausos - <INFO_EMAIL>',
        '- Klausimai dėl apmokėjimo ar banko duomenų atnaujinimo - <ACCOUNTS_EMAIL>',
        'Siekiame atsakyti greitai ir be delsimo išspręsti bet kokias problemas.',
        '',
        '4. Onboarding administravimas ir kiti žingsniai',
        'Jūsų sutartis bus atsiųsta atskiru el. laišku.',
        '- Prašome ją peržiūrėti, pasirašyti ir greitai grąžinti, kad išvengtumėte vėlavimų įvedimo procese ir mokėjimų nustatyme.',
        'Jei turite klausimų, tiesiog susisiekite su mumis.',
        '',
        'Sveiki prisijungę - laukiame galimybės dirbti kartu.',
        '',
        'Best regards,',
        '',
        'HMJ Global Team',
      ].join('\n'),
    },
    de: {
      subject: 'Willkommen bei HMJ Global - Ihre Onboarding-Informationen für <COMPANY_NAME>',
      heading: 'Willkommen bei HMJ Global',
      intro: 'Prüfen Sie vor Ihrem Start bei <PLACEMENT_CONTEXT> die HMJ-Informationen zu Zeiterfassung, Vergütung und Support.',
      contextNote: 'Bewahren Sie diese Onboarding-Zusammenfassung auf und nutzen Sie die HMJ-Schaltfläche unten, wenn Sie Zugriff auf das Timesheet Portal benötigen.',
      actionLabel: 'HMJ-Zeiterfassung / Portalzugang öffnen',
      body: [
        'Hallo <FIRST_NAME>,',
        '',
        'Willkommen bei HMJ Global und herzlichen Glückwunsch zu Ihrer Position bei <PLACEMENT_CONTEXT>.',
        '',
        'Wir freuen uns, Sie an Bord zu haben. Bitte nehmen Sie sich vor Ihrem Start einen Moment Zeit, um die folgenden Informationen zu prüfen und zu bestätigen, dass alles in Ordnung ist.',
        '',
        '1. Timesheet Portal - Login-Prüfung (Wichtig)',
        'Sie sollten eine E-Mail erhalten haben, um Ihren Login für das Timesheet Portal einzurichten.',
        '- Bitte melden Sie sich an und stellen Sie sicher, dass Sie Zugriff haben.',
        '- Prüfen Sie, ob Ihre Angaben korrekt sind.',
        '- Falls Sie diese E-Mail nicht erhalten haben, teilen Sie uns dies bitte so schnell wie möglich mit, damit wir sie erneut senden können.',
        '',
        '2. Zeiterfassungs- und Zahlungsprozess',
        'Ihr Stundenzettel wird jede Woche online ausgefüllt.',
        '- Ihr E-Timesheet wird in den frühen Stunden des Montags freigeschaltet und bezieht sich auf die bevorstehende Arbeitswoche.',
        '- Tragen Sie Ihre Stunden im Laufe der Woche direkt im System ein - Sie müssen nichts zurücksenden.',
        '- Bitte stellen Sie sicher, dass Ihr Stundenzettel bis zum Ende der Arbeitswoche vollständig ausgefüllt ist.',
        'Zahlungen werden in der Regel am folgenden Mittwoch bearbeitet, sofern der Stundenzettel genehmigt wurde und fristgerecht eingereicht ist.',
        '',
        '3. Kontakt und Support',
        'Wenn Sie in irgendeiner Phase Hilfe benötigen, können Sie uns kontaktieren:',
        '- Fragen zu Zeiterfassung oder allgemeine Anfragen - <INFO_EMAIL>',
        '- Fragen zu Zahlungen oder zur Aktualisierung von Bankdaten - <ACCOUNTS_EMAIL>',
        'Wir bemühen uns, schnell zu antworten und alle Probleme ohne Verzögerung zu lösen.',
        '',
        '4. Onboarding-Verwaltung und nächste Schritte',
        'Ihr Vertrag wird separat per E-Mail versendet.',
        '- Bitte prüfen, unterschreiben und senden Sie ihn zeitnah zurück, um Verzögerungen beim Onboarding und bei der Einrichtung der Zahlung zu vermeiden.',
        'Wenn Sie Fragen haben, melden Sie sich einfach.',
        '',
        'Willkommen an Bord - wir freuen uns auf die Zusammenarbeit.',
        '',
        'Best regards,',
        '',
        'HMJ Global Team',
      ].join('\n'),
    },
    es: {
      subject: 'Bienvenido a HMJ Global - detalles de su incorporacion para <COMPANY_NAME>',
      heading: 'Bienvenido a HMJ Global',
      intro: 'Revise los detalles de HMJ sobre hojas de horas, pagos y soporte antes de comenzar con <PLACEMENT_CONTEXT>.',
      contextNote: 'Guarde este resumen de incorporacion y utilice el boton de HMJ que aparece a continuacion siempre que necesite acceso a Timesheet Portal.',
      actionLabel: 'Abrir acceso HMJ a partes de horas / portal',
      body: [
        'Hola <FIRST_NAME>,',
        '',
        'Bienvenido a HMJ Global y enhorabuena por haber obtenido su puesto con <PLACEMENT_CONTEXT>.',
        '',
        'Nos alegra contar con usted. Antes de empezar, dedique unos minutos a revisar la informacion siguiente y a confirmar que todo esta en orden.',
        '',
        '1. Timesheet Portal - comprobacion de acceso (Importante)',
        'Deberia haber recibido un correo electronico para configurar su acceso a Timesheet Portal.',
        '- Inicie sesion y confirme que tiene acceso.',
        '- Compruebe que sus datos son correctos.',
        '- Si no ha recibido este correo, haganoslo saber lo antes posible y se lo reenviamos.',
        '',
        '2. Proceso de partes de horas y pago',
        'Su hoja de horas se completa online cada semana.',
        '- Su e-timesheet se publica en las primeras horas del lunes y corresponde a la semana laboral siguiente.',
        '- Introduzca sus horas directamente en el sistema durante la semana; no necesita enviar nada de vuelta.',
        '- Asegurese de que su hoja de horas quede completamente cumplimentada antes de que termine la semana laboral.',
        'Los pagos suelen tramitarse el miercoles siguiente, sujetos a la aprobacion de la hoja de horas y a su envio dentro del plazo requerido.',
        '',
        '3. Contacto y soporte',
        'Si necesita ayuda en cualquier momento, puede ponerse en contacto con nosotros:',
        '- Consultas sobre partes de horas o consultas generales - <INFO_EMAIL>',
        '- Consultas sobre pagos o actualizacion de datos bancarios - <ACCOUNTS_EMAIL>',
        'Nuestro objetivo es responder con rapidez y resolver cualquier incidencia sin demora.',
        '',
        '4. Administracion del onboarding y siguientes pasos',
        'Su contrato se enviara por correo electronico por separado.',
        '- Reviselo, firmelo y devuelvalo con prontitud para evitar retrasos en la incorporacion y en la configuracion del pago.',
        'Si tiene alguna pregunta, no dude en ponerse en contacto con nosotros.',
        '',
        'Bienvenido a bordo - esperamos trabajar con usted.',
        '',
        'Best regards,',
        '',
        'HMJ Global Team',
      ].join('\n'),
    },
  };

  function buildConfirmationDefaults(language) {
    const key = normaliseConfirmationLanguage(language);
    return {
      language: key,
      ...CONFIRMATION_TEMPLATES[key],
    };
  }

  function tokenValue(rawToken, context = {}) {
    const normalized = String(rawToken || '')
      .trim()
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();

    const key = {
      FIRST_NAME: 'first_name',
      LAST_NAME: 'last_name',
      FULL_NAME: 'full_name',
      COMPANY: 'company_name',
      COMPANY_NAME: 'company_name',
      CLIENT: 'company_name',
      CLIENT_NAME: 'company_name',
      PROJECT: 'project_location',
      PROJECT_LOCATION: 'project_location',
      LOCATION: 'project_location',
      PLACEMENT_CONTEXT: 'placement_context',
      SUPPORT_EMAIL: 'support_email',
      INFO_EMAIL: 'info_email',
      GENERAL_SUPPORT_EMAIL: 'info_email',
      ACCOUNTS_EMAIL: 'accounts_email',
      PAYMENTS_EMAIL: 'accounts_email',
    }[normalized];

    if (!key) return null;
    return String(context[key] || '').trim();
  }

  function renderMergeTokens(text, context = {}) {
    const source = String(text == null ? '' : text);
    const replacer = (match, token) => {
      const value = tokenValue(token, context);
      return value == null ? match : value;
    };
    return source
      .replace(/<\s*([A-Za-z0-9 _-]+?)\s*>/g, replacer)
      .replace(/\{\{\s*([A-Za-z0-9 _-]+?)\s*\}\}/g, replacer);
  }

  function splitBlocks(text) {
    return String(text || '')
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);
  }

  function renderSegments(lines, options = {}) {
    const paragraphStyle = options.paragraphStyle || 'margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7;';
    const listStyle = options.listStyle || 'margin:0 0 4px 18px;padding:0;color:#42557f;font-size:15px;line-height:1.7;';
    const itemStyle = options.itemStyle || 'margin:0 0 8px;';
    const segments = [];
    let paragraphBuffer = [];
    let listBuffer = [];

    function flushParagraph() {
      if (!paragraphBuffer.length) return;
      segments.push(`<p style="${paragraphStyle}">${paragraphBuffer.map((line) => escapeHtml(line)).join('<br>')}</p>`);
      paragraphBuffer = [];
    }

    function flushList() {
      if (!listBuffer.length) return;
      segments.push(`<ul style="${listStyle}">${listBuffer.map((line) => `<li style="${itemStyle}">${escapeHtml(line)}</li>`).join('')}</ul>`);
      listBuffer = [];
    }

    lines.forEach((line) => {
      const clean = trimString(line);
      if (!clean) return;
      if (/^[-•]\s+/.test(clean)) {
        flushParagraph();
        listBuffer.push(clean.replace(/^[-•]\s+/, ''));
        return;
      }
      flushList();
      paragraphBuffer.push(clean);
    });

    flushParagraph();
    flushList();
    return segments.join('');
  }

  function renderConfirmationBodyHtml(body, context = {}) {
    const rendered = renderMergeTokens(body, context);
    return splitBlocks(rendered).map((block) => {
      const lines = block.split('\n').map((line) => trimString(line)).filter(Boolean);
      if (!lines.length) return '';
      if (/^\d+\.\s+/.test(lines[0])) {
        return `<div style="margin:0 0 18px;padding:18px;border:1px solid #dbe4f6;border-left:4px solid #3154b3;border-radius:18px;background:#f8fbff;">
          <p style="margin:0 0 12px;color:#173779;font-size:16px;line-height:1.5;font-weight:800;"><strong>${escapeHtml(lines[0])}</strong></p>
          ${renderSegments(lines.slice(1))}
        </div>`;
      }
      return renderSegments(lines, {
        paragraphStyle: 'margin:0 0 14px;color:#42557f;font-size:15px;line-height:1.75;',
        listStyle: 'margin:0 0 10px 18px;padding:0;color:#42557f;font-size:15px;line-height:1.75;',
      });
    }).join('');
  }

  return {
    ACCOUNTS_SUPPORT_EMAIL,
    DEFAULT_CONFIRMATION_LANGUAGE,
    GENERAL_SUPPORT_EMAIL,
    LANGUAGE_OPTIONS,
    buildConfirmationContext,
    buildConfirmationDefaults,
    buildPlacementContext,
    languageLabel,
    normaliseConfirmationLanguage,
    renderConfirmationBodyHtml,
    renderMergeTokens,
    splitBlocks,
  };
}));
