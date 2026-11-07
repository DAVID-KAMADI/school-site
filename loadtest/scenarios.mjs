// What simulated visitors do. All personal details are made up; every account uses @loadtest.invalid.
import { pick, rand, think, sleep } from './lib.mjs';

const PAGES = ['/', '/courses', '/academics', '/admissions', '/about-us', '/student-life', '/contact-us', '/upcomming-events', '/blog'];
const COUNTIES = ['Nairobi', 'Kiambu', 'Nakuru', 'Mombasa', 'Kisumu', 'Machakos', 'Nyeri', 'Kakamega'];
const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const phone = () => `07${digits(8)}`;

/** Static files are fetched once per visitor (a browser caches them afterwards). */
async function assets(v, html) {
  const srcs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]).filter((s) => s.startsWith('/') || !s.includes('//'));
  for (const s of srcs.slice(0, 6)) await v.request('asset', 'GET', s.startsWith('/') ? s : `/${s}`);
}

/** A visitor reading the site: home, courses, a few pages, sometimes a refresh or a broken link. */
export async function browse(v, ctx) {
  const home = await v.request('page:home', 'GET', '/');
  if (!v.assetsLoaded && home.text) {
    v.assetsLoaded = true;
    await assets(v, home.text);
  }
  await think(3, 10, ctx.think);
  await v.request('page:courses', 'GET', '/courses');
  await think(5, 20, ctx.think); // reading the course list, filtering it in the browser
  const pages = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < pages; i++) {
    const p = pick(PAGES);
    await v.request(p === '/blog' ? 'page:blog' : 'page:other', 'GET', p);
    if (Math.random() < 0.15) await v.request('page:refresh', 'GET', p); // impatient refresh
    await think(4, 15, ctx.think);
  }
  if (Math.random() < 0.1) await v.request('page:404', 'GET', `/no-such-page-${Math.floor(Math.random() * 50)}`, { expect: [404] });
}

/** Retries a failed request once after a pause, like a person pressing the button again. */
async function withRetry(fn) {
  const first = await fn();
  if (first.status === 0 || first.status >= 500) {
    await sleep(2000);
    const again = await fn();
    again.retried = true;
    return again;
  }
  return first;
}

function sections(options, n) {
  const programme = pick(options.programmes);
  const intake = pick(options.intakes);
  return {
    programme: { intakeId: intake.id, programmeId: programme.id, studyMode: pick(programme.studyModes ?? ['full_time']) },
    personal: {
      firstName: 'Loadtest',
      middleName: '',
      lastName: `Applicant${n}`,
      dateOfBirth: `${2000 + Math.floor(Math.random() * 6)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`,
      gender: pick(['female', 'male']),
      nationality: 'Kenyan',
      idType: 'national_id',
      idNumber: digits(8),
      phone: phone(),
      country: 'Kenya',
      county: pick(COUNTIES),
      region: '',
      address: `P.O. Box ${digits(4)} Test Town`,
      disability: '',
    },
    nextOfKin: { name: 'Synthetic Guardian', relationship: 'Parent', phone: phone(), email: '' },
    education: {
      kcseIndexNumber: digits(11),
      kcseYear: 2023,
      meanGrade: 'A-',
      secondarySchool: 'Synthetic High School',
      subjects: [
        { subject: 'Mathematics', grade: 'A-' },
        { subject: 'English', grade: 'B+' },
      ],
      otherQualifications: [],
    },
    funding: { method: pick(['self', 'parent_guardian', 'helb']), sponsorName: '' },
  };
}

function uploadForm(file, typeId) {
  const form = new FormData();
  form.append('documentTypeId', String(typeId));
  form.append('file', new Blob([file.data], { type: file.type }), file.name);
  return form;
}

/** Which test file goes with each required document type. */
function plan(options, files) {
  const required = options.documentTypes.filter((d) => d.isRequired);
  const pdfs = [files.id, files.kcse];
  return required.map((d, i) => ({ typeId: d.id, file: d.accepts === 'image' ? files.photo : pdfs.at(i % 2) }));
}

/**
 * The applicant journey: find the course, register, fill the five sections, upload documents,
 * review, submit, then check the status. Some abandon part-way, some double-click Submit.
 * `outcome` records what the visitor was told, to compare with the database afterwards.
 */
export async function apply(v, ctx) {
  const n = ctx.nextApplicant++;
  const email = `lt-${ctx.runId}-${n}@loadtest.invalid`;
  const outcome = { email, n, registered: false, sectionsSaved: 0, uploads: 0, submitted: false, submitStatuses: [], finalStatus: null, applicationNumber: null, abandonedAt: null };
  ctx.outcomes.push(outcome);

  await v.request('page:home', 'GET', '/');
  await think(3, 8, ctx.think);
  await v.request('page:courses', 'GET', '/courses');
  await think(5, 20, ctx.think);
  await v.request('page:admissions', 'GET', '/admissions');
  await think(3, 10, ctx.think);
  await v.request('page:apply', 'GET', '/apply');
  const opts = await v.request('api:options', 'GET', '/api/v1/applicant/options');
  if (!opts.json) return outcome;
  await think(10, 30, ctx.think); // reading requirements, filling the sign-up form

  const reg = await withRetry(() =>
    v.request('api:register', 'POST', '/api/v1/applicant/register', {
      json: { fullName: `Loadtest Applicant ${n}`, email, phone: phone(), password: `Lt-${ctx.runId}-Pass-${n}!`, acceptTerms: true },
      expect: [201],
    }),
  );
  // A retried registration can meet the account the first try created: that still counts as registered.
  outcome.registered = reg.status === 201 || (reg.retried && reg.status === 409);
  if (!outcome.registered) return outcome;
  ctx.accounts.push({ email, password: `Lt-${ctx.runId}-Pass-${n}!` });

  // The portal loads the options and the application side by side.
  await Promise.all([v.request('api:options', 'GET', '/api/v1/applicant/options'), v.request('api:application', 'GET', '/api/v1/applicant/application')]);

  const data = sections(opts.json, n);
  const abandonAfter = Math.random() < ctx.abandonRate ? Math.floor(rand(0, 6)) : 99;
  let i = 0;
  for (const [key, value] of Object.entries(data)) {
    if (i++ === abandonAfter) {
      outcome.abandonedAt = key;
      return outcome;
    }
    await think(15, 60, ctx.think); // typing the section
    const r = await withRetry(() => v.request('api:save-section', 'PUT', `/api/v1/applicant/application/sections/${key}`, { json: { data: value } }));
    if (r.ok) outcome.sectionsSaved++;
    if (Math.random() < 0.05) await v.request('api:application', 'GET', '/api/v1/applicant/application'); // page refresh
  }

  for (const { typeId, file } of plan(opts.json, ctx.files)) {
    await think(8, 25, ctx.think); // finding the file on the phone
    const r = await withRetry(() => v.request('api:upload', 'POST', '/api/v1/applicant/application/documents', { form: uploadForm(file, typeId) }));
    if (r.ok) outcome.uploads++;
  }
  if (abandonAfter === 5) {
    outcome.abandonedAt = 'review';
    return outcome;
  }

  await v.request('api:application', 'GET', '/api/v1/applicant/application'); // review
  await think(10, 30, ctx.think);
  const submit = () => v.request('api:submit', 'POST', '/api/v1/applicant/application/submit', { json: { declaration: true } });
  // Some people double-click: two submits leave at the same moment.
  const results = Math.random() < ctx.doubleSubmitRate ? await Promise.all([submit(), submit()]) : [await withRetry(submit)];
  outcome.submitStatuses = results.map((r) => r.status);
  outcome.submitted = results.some((r) => r.status === 200);
  if (outcome.submitted) ctx.submittedTimes.push(Date.now());

  await think(5, 15, ctx.think);
  const status = await v.request('api:status', 'GET', '/api/v1/applicant/application');
  outcome.finalStatus = status.json?.status ?? status.json?.application?.status ?? null;
  outcome.applicationNumber = status.json?.applicationNumber ?? status.json?.application?.applicationNumber ?? null;
  return outcome;
}

/** A returning applicant signs in and checks their status. */
export async function returning(v, ctx) {
  const acct = ctx.accounts.length ? pick(ctx.accounts) : null;
  if (!acct) return browse(v, ctx);
  await v.request('page:apply', 'GET', '/apply/application');
  await v.request('api:csrf', 'GET', '/api/v1/auth/csrf');
  const r = await withRetry(() => v.request('api:login', 'POST', '/api/v1/auth/login', { json: { email: acct.email, password: acct.password } }));
  if (!r.ok) return;
  await v.request('api:status', 'GET', '/api/v1/applicant/application');
  await think(5, 15, ctx.think);
  await v.request('api:logout', 'POST', '/api/v1/auth/logout');
}

export { uploadForm, plan, sections };
