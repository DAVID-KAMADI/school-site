/**
 * Catches passwords that meet the length rule but are still easy to guess:
 * a common word or keyboard pattern padded with digits/symbols ("Password2024!", "Qwerty123456"),
 * one character repeated, or a simple sequence.
 */

/** Words and patterns that top leaked-password lists, plus words people use for a school site. */
const COMMON = new Set(
  [
    // leaked-list favourites
    'password',
    'passw0rd',
    'pass',
    'passwd',
    'qwerty',
    'qwertyuiop',
    'asdfgh',
    'asdfghjkl',
    'zxcvbn',
    'zxcvbnm',
    'qazwsx',
    'qweasd',
    '1qaz2wsx',
    'abc',
    'abcd',
    'abcdef',
    'iloveyou',
    'loveyou',
    'welcome',
    'letmein',
    'admin',
    'administrator',
    'root',
    'login',
    'master',
    'monkey',
    'dragon',
    'football',
    'baseball',
    'soccer',
    'superman',
    'batman',
    'princess',
    'sunshine',
    'shadow',
    'michael',
    'charlie',
    'jordan',
    'freedom',
    'whatever',
    'trustno',
    'hello',
    'secret',
    'changeme',
    'default',
    'test',
    'tester',
    'testing',
    'guest',
    'user',
    'computer',
    'internet',
    'starwars',
    'pokemon',
    'cheese',
    'flower',
    'summer',
    'winter',
    'spring',
    'autumn',
    'january',
    'february',
    'march',
    'april',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
    'monday',
    'friday',
    'jesus',
    'christ',
    'blessed',
    'faith',
    'amen',
    'god',
    'love',
    'lovely',
    'family',
    'money',
    'chelsea',
    'arsenal',
    'liverpool',
    'manchester',
    'barcelona',
    'madrid',
    // local and site-specific
    'kenya',
    'nairobi',
    'mombasa',
    'kisumu',
    'nakuru',
    'eldoret',
    'mpesa',
    'safaricom',
    'jambo',
    'harambee',
    'school',
    'college',
    'university',
    'institute',
    'student',
    'students',
    'teacher',
    'lecturer',
    'staff',
    'admission',
    'admissions',
    'apply',
    'application',
    'applicant',
    'portal',
    'campus',
    'education',
    'academy',
    'website',
    'editor',
    'principal',
  ].map((w) => w.toLowerCase()),
);

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
};

/** "P@ssw0rd2024!" -> "password"; "Qwerty123456" -> "qwerty". */
function core(password: string): string[] {
  const lower = password.toLowerCase();
  const stripped = lower.replace(/^[\d\W_]+|[\d\W_]+$/g, '');
  const unleet = (s: string) => s.replace(/[0134578@$!]/g, (c) => LEET[c] ?? c);
  const candidates = [
    lower,
    stripped,
    unleet(lower),
    unleet(stripped),
    unleet(lower).replace(/[\d\W_]+$/g, ''),
  ];
  return [...new Set(candidates.filter(Boolean))];
}

function isSequence(s: string): boolean {
  if (s.length < 4) return false;
  const step = s.charCodeAt(1) - s.charCodeAt(0);
  if (Math.abs(step) !== 1) return false;
  for (let i = 2; i < s.length; i++)
    if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== step) return false;
  return true;
}

/** Returns a reason when the password is too easy to guess, otherwise null. */
export function weakPasswordReason(
  password: string,
  extraWords: string[] = [],
): string | null {
  const lower = password.toLowerCase();
  if (new Set(lower).size <= 3)
    return 'Password uses too few different characters.';
  if (/^\d+$/.test(lower)) return 'Password cannot be only numbers.';
  if (isSequence(lower) || /^(.{1,4})\1+$/.test(lower))
    return 'Password is a simple pattern. Try a few unrelated words instead.';
  const extras = extraWords
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 4);
  for (const c of core(password)) {
    // A common word, possibly repeated ("passwordpassword") or doubled up with digits.
    const base = c.replace(/(.+?)\1+$/, '$1');
    if (
      COMMON.has(c) ||
      COMMON.has(base) ||
      extras.includes(c) ||
      extras.includes(base) ||
      isSequence(c)
    ) {
      return 'Password is too common or easy to guess. Try a few unrelated words, e.g. "river-mango-lantern-7".';
    }
  }
  return null;
}
