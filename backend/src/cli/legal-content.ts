/**
 * Starting text for the Terms of Service, Privacy Policy and Data Processing Agreement pages.
 * Written for Kenya's Data Protection Act, 2019, and for what this system actually collects.
 * Text in [square brackets] must be completed by the institution. Have an advocate review all three
 * documents before the site goes live; after seeding they are ordinary pages, edited in the admin.
 */

export interface LegalVars {
  name: string;
  short: string;
  address: string;
  email: string;
  phone: string;
  /** e.g. "1 October 2026" */
  updated: string;
  version: string;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );

export function termsOfService(raw: LegalVars): string {
  const v = Object.fromEntries(
    Object.entries(raw).map(([k, val]) => [k, esc(val)]),
  ) as unknown as LegalVars;
  return `
<p><strong>Last updated: ${v.updated}</strong> (version ${v.version})</p>
<p>These Terms of Service set out the agreement between you and <strong>${v.name}</strong> ("${v.short}", "we", "us") when you use this website, create an account, apply for admission, or use the staff administration area (together, "the system"). By creating an account or using the system you agree to these terms. If you do not agree, please do not use the system.</p>
<p>How we handle your personal information is explained in our <a href="/privacy-policy">Privacy Policy</a>, which forms part of these terms.</p>

<h2>1. Who we are</h2>
<p>${v.name} is [a TVET institution registered with TVETA under registration number ___ / a private institution registered under ___]. Our address is ${v.address}. You can contact us at <a href="mailto:${v.email}">${v.email}</a> or ${v.phone}.</p>

<h2>2. Who can use the system</h2>
<ul>
<li><strong>Visitors</strong> can read the public website without an account.</li>
<li><strong>Applicants</strong> can create an account to apply for admission. If you are under 18, your parent or guardian must agree to your application and to these terms on your behalf.</li>
<li><strong>Staff</strong> are given an account by the institution to manage the website and admissions. Section 7 applies to staff.</li>
</ul>

<h2>3. Your account</h2>
<ul>
<li>Give accurate information and keep it up to date.</li>
<li>Create only one applicant account, in your own name.</li>
<li>Keep your password private and do not let anyone else use your account. You are responsible for what is done through your account.</li>
<li>Tell us straight away at <a href="mailto:${v.email}">${v.email}</a> if you think someone else has used your account.</li>
<li>We may suspend or close an account that breaks these terms, is used fraudulently, or puts other users or the system at risk. Where possible we will tell you why.</li>
</ul>

<h2>4. Applying for admission</h2>
<ul>
<li>Everything you submit must be true and complete, and every document you upload must be genuine and yours. Giving false information or forged documents may lead to your application being rejected, an offer being withdrawn, or admission being cancelled, even after you have joined. We may also report fraud to the relevant authorities.</li>
<li>We check the documents you upload, and we will ask to see the originals when you report.</li>
<li><strong>Application fee:</strong> the fee shown on the Apply page must be paid for your application to be processed. [The application fee is not refundable, except where we cancel the programme or intake / State your refund policy.]</li>
<li>An application does not guarantee admission. Decisions are made by our admissions staff based on the programme requirements and the places available.</li>
<li>An offer of admission is valid only if you accept it through your account before the deadline in your offer letter, and it remains subject to verification of your original documents and to payment of fees.</li>
<li>You can withdraw an application at any time before a decision is made.</li>
</ul>

<h2>5. Acceptable use</h2>
<p>When using the system you must not:</p>
<ul>
<li>try to access another person's account or information, or any part of the system you have not been given access to;</li>
<li>test, probe or bypass security measures, or attempt to disrupt or overload the system;</li>
<li>upload viruses, malicious files, or content that is unlawful, offensive or infringes someone else's rights;</li>
<li>use automated tools to copy content or collect information about other people;</li>
<li>pretend to be someone else, or misrepresent your connection with the institution.</li>
</ul>
<p>Misuse may lead to your account being closed and, where it breaks the law (for example the Computer Misuse and Cybercrimes Act, 2018), being reported to the authorities.</p>

<h2>6. Content and intellectual property</h2>
<ul>
<li>The website's text, photos, logos and design belong to ${v.name} or are used with permission. You may view, print and share pages for personal, non-commercial use. Any other use needs our written permission.</li>
<li>You keep ownership of the documents and information you submit. You allow us to store, copy and use them only to process your application and for the other purposes set out in the Privacy Policy.</li>
</ul>

<h2>7. Staff accounts</h2>
<p>If you have a staff account you also agree to:</p>
<ul>
<li>use the system and any personal information in it only for your duties at ${v.short}, and keep that information confidential, during and after your employment;</li>
<li>use two-step login, never share your password or authenticator codes, and sign out of shared computers;</li>
<li>not download, copy or send applicants' personal information outside the system unless your duties require it and it is done securely;</li>
<li>report any suspected security incident or data breach immediately to [the Data Protection Officer / ICT office] at [email].</li>
</ul>
<p>All actions in the administration area are recorded in an audit log.</p>

<h2>8. Availability and links</h2>
<p>We work to keep the system available and accurate, but it may sometimes be unavailable for maintenance or for reasons outside our control. Programme details, fees and dates can change; the information confirmed in your offer letter takes precedence. The website may link to or show content from other websites (for example videos or maps). We are not responsible for those websites, which have their own terms.</p>

<h2>9. Responsibility</h2>
<p>As far as the law allows, ${v.name} is not liable for losses caused by events outside our reasonable control, by you not keeping your account details secure, or by information you provided being wrong. Nothing in these terms limits any rights you have under Kenyan law, including under the Consumer Protection Act, 2012 and the Data Protection Act, 2019.</p>

<h2>10. Changes to these terms</h2>
<p>We may update these terms. The date and version at the top show when they last changed. If we make an important change we will tell account holders and, where required, ask you to agree again. Each applicant account records the version that was agreed to.</p>

<h2>11. Law and disputes</h2>
<p>These terms are governed by the laws of Kenya. If you have a concern, please contact us first so we can try to resolve it. Any dispute that cannot be resolved will be decided by the courts of Kenya.</p>

<h2>12. Contact</h2>
<p>${v.name}, ${v.address}. Email <a href="mailto:${v.email}">${v.email}</a>, phone ${v.phone}.</p>
`.trim();
}

export function privacyPolicy(raw: LegalVars): string {
  const v = Object.fromEntries(
    Object.entries(raw).map(([k, val]) => [k, esc(val)]),
  ) as unknown as LegalVars;
  return `
<p><strong>Last updated: ${v.updated}</strong> (version ${v.version})</p>
<p>This Privacy Policy explains what personal information <strong>${v.name}</strong> ("${v.short}", "we") collects through this website and the online application system, why we collect it, who can see it, how long we keep it, and the rights you have under the <strong>Data Protection Act, 2019</strong> of Kenya.</p>

<h2>1. Who is responsible for your information</h2>
<p>${v.name} is the <em>data controller</em> for the personal information described here. We are registered with the Office of the Data Protection Commissioner (ODPC) [as a data controller, registration number ___].</p>
<p><strong>Data Protection Officer:</strong> [Name], [email address], ${v.phone}, ${v.address}.</p>

<h2>2. What we collect</h2>
<h3>When you visit the website</h3>
<ul>
<li>Our servers record technical details needed to deliver pages and keep the site secure: your IP address, browser type, the page requested and the time. We do <strong>not</strong> use analytics, advertising or tracking cookies, and we do not build profiles of visitors.</li>
</ul>
<h3>When you create an applicant account</h3>
<ul>
<li>Full name, email address, mobile phone number, and your password (stored only in a scrambled, one-way form that no one, including our staff, can read).</li>
<li>The date you agreed to these policies and which version you agreed to.</li>
</ul>
<h3>When you apply</h3>
<table>
<thead><tr><th scope="col">Section</th><th scope="col">Information</th></tr></thead>
<tbody>
<tr><td>Programme</td><td>Intake, programme and study mode you choose.</td></tr>
<tr><td>Personal details</td><td>Names, date of birth, gender, nationality, identity document type and number (national ID, birth certificate, passport or alien ID), country and county or region of residence, postal or physical address, and any disability or support needs you choose to tell us about.</td></tr>
<tr><td>Next of kin</td><td>Name, relationship to you, phone number and (optionally) email.</td></tr>
<tr><td>Education</td><td>KCSE index number, year and mean grade, subject grades, secondary school, and other qualifications.</td></tr>
<tr><td>Funding</td><td>How you plan to pay fees (for example self, parent or guardian, HELB, bursary or sponsor) and the sponsor's name.</td></tr>
<tr><td>Documents</td><td>The files you upload, such as your ID or birth certificate, KCSE certificate or result slip, passport photo and other certificates.</td></tr>
<tr><td>Application fee</td><td>The M-Pesa confirmation code you enter and whether staff have confirmed the payment.</td></tr>
<tr><td>Decisions</td><td>Notes, status changes, offers and your response to an offer.</td></tr>
</tbody>
</table>
<p>Some of this is <strong>sensitive personal data</strong> under the Act, in particular health or disability information, gender and family details (next of kin). We collect it only where it is needed for admission or to support you, and we protect it with the extra care described in section 7. Telling us about a disability is optional and will not count against your application.</p>
<h3>When you sign in</h3>
<ul>
<li>Your IP address and browser details for each signed-in session, and a record of sign-ins and failed attempts, to protect your account and investigate misuse.</li>
</ul>

<h2>3. Why we use it, and our legal basis</h2>
<table>
<thead><tr><th scope="col">Purpose</th><th scope="col">Legal basis (Data Protection Act, s.30)</th></tr></thead>
<tbody>
<tr><td>Creating your account and processing your application, including checking your eligibility and documents</td><td>Your consent, and taking steps at your request before entering into a contract with you (admission)</td></tr>
<tr><td>Making and managing offers of admission and preparing your enrolment</td><td>Performance of a contract with you</td></tr>
<tr><td>Confirming payment of the application fee</td><td>Performance of a contract with you</td></tr>
<tr><td>Meeting our obligations to regulators and government (for example TVETA, KUCCPS or HELB, where applicable)</td><td>Compliance with a legal obligation</td></tr>
<tr><td>Keeping the system secure, preventing fraud, and keeping an audit log of staff actions</td><td>Our legitimate interests in protecting applicants and the institution</td></tr>
<tr><td>Anonymous statistics on applications (for example numbers per programme) to plan intakes</td><td>Our legitimate interests; no individual can be identified</td></tr>
</tbody>
</table>
<p>We do not sell your information and we do not use it for marketing without your separate consent. Admission decisions are made by people: the system may flag, for example, that a grade is below a programme's minimum, but no decision about you is made by automated means alone.</p>

<h2>4. Children</h2>
<p>Applicants may be under 18. If you are under 18, your parent or guardian must agree to your application, as required by section 33 of the Act. We may contact your parent or guardian (your next of kin) to confirm this.</p>

<h2>5. Who can see your information</h2>
<ul>
<li><strong>Our staff</strong>, only where their role requires it: admissions officers, finance staff confirming fees, and system administrators. Access is controlled by role, needs two-step login, and every action is recorded in an audit log.</li>
<li><strong>Service providers</strong> that run parts of the system for us under a written data processing agreement (see our <a href="/data-processing-agreement">Data Processing Agreement</a>, which lists them): currently the company that hosts our servers [name, location] and our off-site backup storage [name, location]. Text-message, email and M-Pesa payment services are not yet in use; if we start using them we will update this policy and the list first.</li>
<li><strong>Government bodies and regulators</strong>, when the law requires it.</li>
<li><strong>Our student records system.</strong> If you accept a place, your details are used to register you as a student in the institution's student portal.</li>
</ul>
<h3>Third-party content on public pages</h3>
<p>Some public pages show content from other services, which then receive your IP address and browser details directly and act under their own privacy policies:</p>
<ul>
<li><strong>YouTube (Google)</strong>: video preview images load from Google's servers when a page with a video is shown. The video itself only loads if you press play, using YouTube's privacy-enhanced mode.</li>
<li><strong>Vimeo</strong>: videos load only if you press play.</li>
<li><strong>OpenStreetMap</strong>: the campus map on the contact page loads from the OpenStreetMap Foundation.</li>
</ul>

<h2>6. Where your information is stored</h2>
<p>Your information is stored on servers in [Kenya / country of the hosting provider]. If any information is transferred outside Kenya, we do so only as allowed by sections 48 to 50 of the Act, with appropriate safeguards, and we will name the country in this policy.</p>

<h2>7. How we protect it</h2>
<ul>
<li>All connections to the site are encrypted (HTTPS).</li>
<li>Passwords are stored using a strong one-way algorithm (Argon2id). Staff must use two-step login, and accounts lock after repeated failed sign-ins.</li>
<li>Uploaded documents are kept in private storage that is never publicly accessible and is served only to you and authorised staff.</li>
<li>Staff access is limited by role, and every sign-in and change is recorded in an audit log.</li>
<li>We keep regular backups, which are checked to make sure they can be restored.</li>
</ul>
<p>If a breach puts your information at risk, we will notify the Data Protection Commissioner within 72 hours of becoming aware of it and tell you without undue delay, as required by section 43 of the Act.</p>

<h2>8. How long we keep it</h2>
<table>
<thead><tr><th scope="col">Information</th><th scope="col">Kept for</th></tr></thead>
<tbody>
<tr><td>Applications that are not completed, are unsuccessful, withdrawn or declined, with their documents</td><td>[2 years] after the intake closes, then deleted</td></tr>
<tr><td>Applications that lead to enrolment</td><td>Moved to your student record, which is kept under the institution's student records policy [state period]</td></tr>
<tr><td>Applicant accounts with no application</td><td>[1 year] after the last sign-in, then deleted</td></tr>
<tr><td>Sign-in sessions</td><td>Deleted automatically when they expire (at most 12 hours)</td></tr>
<tr><td>Audit log of sign-ins and staff actions</td><td>[2 years]</td></tr>
<tr><td>Backups</td><td>Replaced on a rolling basis (about [14] days)</td></tr>
</tbody>
</table>

<h2>9. Cookies</h2>
<p>We use only the cookies needed for the site to work, so we do not ask for cookie consent:</p>
<table>
<thead><tr><th scope="col">Name</th><th scope="col">Purpose</th><th scope="col">Duration</th></tr></thead>
<tbody>
<tr><td>sid</td><td>Keeps you signed in. Cannot be read by scripts on the page.</td><td>Until you sign out, or at most 12 hours</td></tr>
<tr><td>XSRF-TOKEN</td><td>Security: stops other websites from submitting forms in your name.</td><td>Your browsing session</td></tr>
</tbody>
</table>
<p>If you close a notice banner, your browser remembers this until you close the tab (session storage). No information is sent to us.</p>

<h2>10. Your rights</h2>
<p>Under section 26 of the Act you have the right to:</p>
<ul>
<li>be told how your information is used (this policy);</li>
<li>see the personal information we hold about you and get a copy;</li>
<li>correct information that is wrong or incomplete (you can also update your application yourself until you submit it);</li>
<li>ask us to delete information we no longer have a lawful reason to keep;</li>
<li>object to processing, or withdraw consent at any time. Withdrawing consent does not affect processing already done, but we may then be unable to continue with your application;</li>
<li>ask us to transfer your information to you or another organisation in a commonly used electronic format.</li>
</ul>
<p>To use any of these rights, email our Data Protection Officer at [email] from the address on your account, or write to us at ${v.address}. We may need to confirm your identity first. We will respond within the time set by the Data Protection (General) Regulations, 2021, and there is no charge.</p>
<p>If you are not happy with how we handle your information, you can complain to the <strong>Office of the Data Protection Commissioner</strong>: <a href="https://www.odpc.go.ke" target="_blank" rel="noopener noreferrer">www.odpc.go.ke</a>.</p>

<h2>11. Changes to this policy</h2>
<p>We will update this policy when the way we use information changes, for example before we start sending SMS or email notifications. The date and version at the top show the latest change. We will tell account holders about important changes.</p>
`.trim();
}

export function dataProcessingAgreement(raw: LegalVars): string {
  const v = Object.fromEntries(
    Object.entries(raw).map(([k, val]) => [k, esc(val)]),
  ) as unknown as LegalVars;
  return `
<p><strong>Last updated: ${v.updated}</strong> (version ${v.version})</p>
<p>${v.name} uses some outside service providers to run this website and application system. When a provider stores or handles personal information for us, it acts as our <em>data processor</em> and must sign an agreement on the terms below, as required by section 42 of the <strong>Data Protection Act, 2019</strong>. This page publishes those standard terms and lists the providers that handle personal information, so applicants and staff can see who touches their data.</p>
<p>Providers: please contact <a href="mailto:${v.email}">${v.email}</a> for the signature copy of this agreement.</p>

<h2>Part A. Providers that handle personal information</h2>
<table>
<thead><tr><th scope="col">Provider and service</th><th scope="col">Role</th><th scope="col">Personal information</th><th scope="col">Location</th><th scope="col">Status</th></tr></thead>
<tbody>
<tr><td>[Hosting company]: servers and database for the website</td><td>Processor</td><td>All information described in the Privacy Policy</td><td>[Country]</td><td>[To be appointed before launch]</td></tr>
<tr><td>[Backup storage provider]: off-site encrypted backups</td><td>Processor</td><td>Copies of the database and uploaded documents</td><td>[Country]</td><td>[To be appointed before launch]</td></tr>
<tr><td>SMS provider: application status messages</td><td>Processor</td><td>Name, phone number, message text</td><td>-</td><td>Not in use</td></tr>
<tr><td>Email provider: application status emails</td><td>Processor</td><td>Name, email address, message text</td><td>-</td><td>Not in use</td></tr>
<tr><td>Safaricom M-Pesa (Daraja API): fee payment requests</td><td>Processor for payment requests; Safaricom is also an independent controller of M-Pesa records</td><td>Phone number, amount, application number</td><td>Kenya</td><td>Not in use. Applicants currently pay through the Paybill themselves.</td></tr>
</tbody>
</table>
<p>These services are <strong>not processors</strong> and receive no information from our database. They receive a visitor's IP address directly when their content loads on a public page, under their own privacy policies: YouTube (Google), Vimeo, and the OpenStreetMap Foundation. See section 5 of the <a href="/privacy-policy">Privacy Policy</a>.</p>
<p>We will update this list <strong>before</strong> any new provider starts handling personal information.</p>

<h2>Part B. Standard data processing terms</h2>
<p>These terms form an agreement between <strong>${v.name}</strong>, ${v.address} (the "Controller"), and the service provider named in the signed copy (the "Processor").</p>

<h3>1. Definitions</h3>
<p>"Personal data", "processing", "data subject", "data controller", "data processor" and "personal data breach" have the meanings in the Data Protection Act, 2019 (the "Act"). "Regulations" means the Data Protection (General) Regulations, 2021.</p>

<h3>2. Scope and instructions</h3>
<ol>
<li>The Processor processes personal data only to provide the services described in Annex 1, and only on the Controller's documented instructions, including these terms.</li>
<li>The Processor will not use the personal data for its own purposes, sell it, or combine it with other data.</li>
<li>If the Processor believes an instruction breaks the Act, it will tell the Controller immediately.</li>
</ol>

<h3>3. Confidentiality</h3>
<p>The Processor ensures that everyone it authorises to process the personal data is bound by confidentiality and receives only the access needed for their work.</p>

<h3>4. Security</h3>
<p>The Processor puts in place appropriate technical and organisational measures to protect the personal data, as required by section 41 of the Act. As a minimum these are the measures in Annex 2, kept under regular review.</p>

<h3>5. Sub-processors</h3>
<ol>
<li>The Processor will not engage another processor without the Controller's prior written authorisation.</li>
<li>Any authorised sub-processor must be bound by written terms giving at least the same protection as these terms. The Processor remains fully responsible for the sub-processor's performance.</li>
</ol>

<h3>6. Transfers outside Kenya</h3>
<p>The Processor will not transfer or store personal data outside Kenya without the Controller's prior written approval, and then only in line with sections 48 to 50 of the Act and the Regulations, with proof of appropriate safeguards.</p>

<h3>7. Helping the Controller</h3>
<ol>
<li>The Processor helps the Controller respond to requests from data subjects exercising their rights (access, correction, deletion, objection, portability), and passes on any request it receives directly within 2 working days without responding to it itself.</li>
<li>The Processor provides the information the Controller reasonably needs for data protection impact assessments (section 31 of the Act), and for dealing with the Data Protection Commissioner.</li>
</ol>

<h3>8. Personal data breaches</h3>
<ol>
<li>The Processor notifies the Controller without delay, and in any case within <strong>48 hours</strong>, of becoming aware of a personal data breach, as required by section 43(2) of the Act.</li>
<li>The notice describes what happened, the data and people affected, the likely consequences, and the steps taken or proposed. The Processor cooperates fully with the investigation, and does not notify regulators or data subjects itself unless the Controller instructs it to.</li>
</ol>

<h3>9. Audits</h3>
<p>The Processor makes available all information needed to show compliance with these terms and allows audits by the Controller or an auditor it appoints, on reasonable notice. Independent certifications (for example ISO/IEC 27001) may be offered as evidence.</p>

<h3>10. End of the service</h3>
<p>When the services end, the Processor, at the Controller's choice, returns all personal data in a commonly used format and then deletes all copies, including backups within [30] days, unless the law requires it to keep them. It confirms the deletion in writing.</p>

<h3>11. Liability, term and law</h3>
<ol>
<li>The Processor is responsible for losses caused by its breach of these terms or of the Act, and indemnifies the Controller against resulting claims and penalties [subject to the limits in the main services contract].</li>
<li>These terms last as long as the Processor processes personal data for the Controller. If they conflict with the main services contract on data protection, these terms take precedence.</li>
<li>These terms are governed by the laws of Kenya and the courts of Kenya have jurisdiction.</li>
</ol>

<h3>Annex 1. Details of processing</h3>
<table>
<tbody>
<tr><th scope="row">Data subjects</th><td>Website visitors, applicants (including applicants under 18), their next of kin, and staff users.</td></tr>
<tr><th scope="row">Categories of data</th><td>As listed in section 2 of the Privacy Policy, including sensitive personal data (health/disability, gender, family details).</td></tr>
<tr><th scope="row">Purpose</th><td>Hosting, storing, backing up or delivering messages for the institution's website and admissions system.</td></tr>
<tr><th scope="row">Duration</th><td>For the length of the services contract, then return and deletion under clause 10.</td></tr>
</tbody>
</table>

<h3>Annex 2. Minimum security measures</h3>
<ul>
<li>Encryption of data in transit (TLS) and at rest (encrypted disks and backups).</li>
<li>Access limited to named personnel, with multi-factor authentication and logging of administrative access.</li>
<li>Prompt security updates, firewalls, and no public network access to databases.</li>
<li>Backups tested regularly; documented incident response; physical security of data centres.</li>
</ul>

<h3>Signatures</h3>
<table>
<tbody>
<tr><th scope="row">For the Controller</th><td>${v.name}<br>Name: [ ]<br>Title: [ ]<br>Signature and date: [ ]</td></tr>
<tr><th scope="row">For the Processor</th><td>[Company name]<br>Name: [ ]<br>Title: [ ]<br>Signature and date: [ ]</td></tr>
</tbody>
</table>
`.trim();
}
