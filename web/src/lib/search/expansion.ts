// Query expansion: what readers type, mapped to what this corpus says — see docs/search.md.
//
// Each entry adds an alternative query, never replaces one, so a term that means something in its
// own right keeps its literal results and gains the corpus's wording alongside them.
//
// Two kinds of entry. **Vocabulary** covers words the editorial layer moved away from what readers
// know: the upstream-to-shipped pairs in scripts/update-data/retranslation.mjs are read from the
// reader's side here, so a query for the word Bhikkhu Sujato used reaches the word this app ships.
// **Sutta names** cover a discourse known by a traditional name that is neither its English title
// nor its Pali one.
//
// Keys are written folded — lowercase, no diacritics — because expandQuery is handed a query that
// searchKey has already folded.
//
// An entry fires wherever its key appears, so a key that is part of a longer query substitutes
// into it: "sloth and torpor" would gain the half-replaced "dullness and torpor" from the `sloth`
// entry. Those phrases match nothing and cost a scan, which is why the table is walked longest key
// first and why a phrase a reader is likely to type whole earns its own entry.
//
// **An English query gains English alternatives only.** The corpus's English translates the Pali,
// so a Pali alternative finds nothing the English didn't — but Pali compounds freely, and a match
// mid-compound ranks as a title hit the row can't explain. Pali is a target only where it is the
// reader's one handle: a term with no English phrase here, a Pali spelling of a Pali query, and the
// titles in the sutta-name table.
import { searchKey } from './metadata';

interface Expansion {
  // The folded phrase a reader types.
  from: string;
  // The alternative queries it adds, best first.
  to: string[];
}

// Vocabulary. The first group is the retranslated terms, read upstream-to-shipped.
const VOCABULARY: Expansion[] = [
  { from: 'mendicant', to: ['bhikkhu'] },
  { from: 'mendicants', to: ['bhikkhus'] },
  { from: 'immersion', to: ['composure'] },
  { from: 'concentration', to: ['composure'] },
  { from: 'absorption', to: ['jhana'] },
  { from: 'absorptions', to: ['jhanas'] },
  { from: 'textual analysis', to: ['analytical knowledge'] },
  { from: 'mindfulness meditation', to: ['establishment of mindfulness'] },
  { from: 'foundations of mindfulness', to: ['establishments of mindfulness'] },
  { from: 'situational awareness', to: ['attentiveness'] },
  { from: 'clear comprehension', to: ['attentiveness'] },
  { from: 'origination', to: ['arising'] },
  { from: 'origin', to: ['arising'] },
  { from: 'vanishing', to: ['passing away'] },
  { from: 'rise and fall', to: ['arising and passing away'] },
  { from: 'perishing', to: ['passing away'] },
  { from: 'anxiety', to: ['agitation'] },
  { from: 'placing the mind', to: ['thought'] },
  { from: 'keeping it connected', to: ['examination'] },
  { from: 'rational application of mind', to: ['proper attention'] },
  { from: 'wise attention', to: ['proper attention'] },
  { from: 'choices', to: ['sankhara'] },
  { from: 'formations', to: ['sankhara'] },
  { from: 'volitional formations', to: ['sankhara'] },
  { from: 'mental fabrications', to: ['sankhara'] },
  // Terms readers know from other translations and from ordinary Buddhist English, which this
  // corpus spells another way. A word this corpus already uses gets no entry: it would only add
  // the noise of a second query for nothing.
  { from: 'loving-kindness', to: ['love'] },
  { from: 'loving kindness', to: ['love'] },
  { from: 'metta', to: ['love'] },
  { from: 'enlightenment', to: ['awakening'] },
  { from: 'enlightened', to: ['awakened'] },
  { from: 'nibbana', to: ['extinguishment'] },
  { from: 'nirvana', to: ['extinguishment', 'nibbana'] },
  { from: 'karma', to: ['deeds', 'kamma'] },
  { from: 'arahant', to: ['perfected'] },
  { from: 'arahants', to: ['perfected'] },
  { from: 'luminous', to: ['radiant'] },
  { from: 'not-self', to: ['not self'] },
  { from: 'taints', to: ['defilements'] },
  { from: 'sotapanna', to: ['stream-enterer'] },
  { from: 'anapanasati', to: ['anapanassati'] },

  // The people of the canon. This corpus says bhikkhu, and the reader's own word for one is
  // "monk" as often as anything a translation uses.
  { from: 'monk', to: ['bhikkhu'] },
  { from: 'monks', to: ['bhikkhus'] },
  { from: 'monastic', to: ['bhikkhu'] },
  { from: 'monastics', to: ['bhikkhus'] },
  { from: 'tathagata', to: ['realized one'] },
  { from: 'blessed one', to: ['buddha'] },
  { from: 'world-honoured one', to: ['buddha'] },
  { from: 'world-honored one', to: ['buddha'] },
  { from: 'fortunate one', to: ['buddha'] },
  { from: 'sakyamuni', to: ['sakyan', 'gotama'] },
  { from: 'worldling', to: ['ordinary person'] },
  { from: 'lay disciple', to: ['lay follower'] },
  { from: 'layman', to: ['lay follower'] },
  { from: 'laywoman', to: ['lay follower'] },
  { from: 'jains', to: ['jain'] },
  { from: 'niganthas', to: ['jain'] },
  { from: 'naga', to: ['dragon'] },
  { from: 'nagas', to: ['dragons'] },
  { from: 'yakkha', to: ['native spirit'] },
  { from: 'yakkhas', to: ['native spirits'] },
  { from: 'gandhabba', to: ['centaur'] },
  { from: 'asura', to: ['titan'] },
  { from: 'asuras', to: ['titans'] },
  { from: 'deity', to: ['god'] },
  { from: 'deities', to: ['gods'] },
  { from: 'brahma', to: ['divinity'] },
  { from: 'hungry ghost', to: ['ghost'] },
  { from: 'hungry ghosts', to: ['ghosts'] },
  { from: 'hell realm', to: ['hell'] },
  { from: 'heavenly realm', to: ['heaven'] },

  // Ordinary Buddhist English, and the words other translations use, read against what this
  // corpus says.
  { from: 'wholesome', to: ['skillful'] },
  { from: 'unwholesome', to: ['unskillful'] },
  { from: 'skilful', to: ['skillful'] },
  { from: 'unskilful', to: ['unskillful'] },
  { from: 'stress', to: ['suffering'] },
  { from: 'unsatisfactoriness', to: ['suffering'] },
  { from: 'non-self', to: ['not-self'] },
  { from: 'no self', to: ['not-self'] },
  { from: 'egolessness', to: ['not-self'] },
  { from: 'soul', to: ['self'] },
  { from: 'thirst', to: ['craving'] },
  { from: 'clinging', to: ['grasping'] },
  { from: 'attachment', to: ['grasping'] },
  { from: 'aversion', to: ['hate'] },
  { from: 'hatred', to: ['hate'] },
  { from: 'ill-will', to: ['ill will'] },
  { from: 'pride', to: ['conceit'] },
  { from: 'cankers', to: ['defilements'] },
  { from: 'effluents', to: ['defilements'] },
  { from: 'influxes', to: ['defilements'] },
  { from: 'outflows', to: ['defilements'] },
  { from: 'fermentations', to: ['defilements'] },
  { from: 'five hindrances', to: ['hindrances'] },
  { from: 'sloth and torpor', to: ['dullness and drowsiness'] },
  { from: 'sloth', to: ['dullness'] },
  { from: 'torpor', to: ['drowsiness'] },
  { from: 'sceptical doubt', to: ['doubt'] },
  { from: 'skeptical doubt', to: ['doubt'] },
  { from: 'sense desire', to: ['sensual desire'] },
  { from: 'sense pleasures', to: ['sensual pleasures'] },
  { from: 'five aggregates', to: ['aggregates'] },
  { from: 'heaps', to: ['aggregates'] },
  { from: 'sense bases', to: ['sense fields'] },
  { from: 'six sense bases', to: ['sense fields'] },
  { from: 'name-and-form', to: ['name and form'] },
  { from: 'mentality-materiality', to: ['name and form'] },
  { from: 'becoming', to: ['continued existence'] },
  { from: 'existence', to: ['continued existence'] },
  { from: 'birth', to: ['rebirth'] },
  { from: 'ageing and death', to: ['old age and death'] },
  { from: 'aging and death', to: ['old age and death'] },
  { from: 'twelve links', to: ['dependent origination'] },
  { from: 'conditioned arising', to: ['dependent origination'] },
  { from: 'conditionality', to: ['dependent origination'] },
  { from: 'dependent origination', to: ['dependent arising'] },
  { from: 'round of rebirths', to: ['transmigration'] },
  { from: 'cycle of rebirth', to: ['transmigration'] },
  { from: 'samsara', to: ['transmigration'] },
  { from: 'the unconditioned', to: ['unconditioned'] },
  { from: 'parinibbana', to: ['full extinguishment'] },
  { from: 'final nibbana', to: ['full extinguishment'] },
  { from: 'disenchantment', to: ['disillusionment'] },
  { from: 'revulsion', to: ['disillusionment'] },
  { from: 'dispassion', to: ['fading away'] },
  { from: 'relinquishment', to: ['letting go'] },
  { from: 'liberation', to: ['freedom'] },
  { from: 'release', to: ['freedom'] },
  { from: 'emancipation', to: ['freedom'] },
  { from: 'volition', to: ['intention'] },
  { from: 'volitions', to: ['intentions'] },
  { from: 'kammic result', to: ['result of deeds'] },
  { from: 'vipaka', to: ['result of deeds'] },
  { from: 'morality', to: ['ethics'] },
  { from: 'virtue', to: ['ethics'] },
  { from: 'moral conduct', to: ['ethics'] },
  { from: 'five precepts', to: ['precepts', 'training rules'] },
  { from: 'eight precepts', to: ['precepts', 'sabbath'] },
  { from: 'uposatha', to: ['sabbath'] },
  { from: 'generosity', to: ['giving'] },
  { from: 'charity', to: ['giving'] },
  { from: 'dana', to: ['giving'] },
  { from: 'solitude', to: ['seclusion'] },
  { from: 'confidence', to: ['faith'] },
  { from: 'heedfulness', to: ['diligence'] },
  { from: 'vigilance', to: ['diligence'] },
  { from: 'discernment', to: ['wisdom'] },
  { from: 'tranquillity', to: ['serenity'] },
  { from: 'tranquility', to: ['serenity'] },
  { from: 'calm abiding', to: ['serenity'] },
  { from: 'samatha', to: ['serenity'] },
  { from: 'samadhi', to: ['composure'] },
  { from: 'one-pointedness', to: ['unified'] },
  { from: 'sympathetic joy', to: ['rejoicing'] },
  { from: 'altruistic joy', to: ['rejoicing'] },
  { from: 'appreciative joy', to: ['rejoicing'] },
  { from: 'divine abidings', to: ['divine meditations'] },
  { from: 'divine abiding', to: ['divine meditation'] },
  { from: 'brahmavihara', to: ['divine meditation', 'love'] },
  { from: 'brahmaviharas', to: ['divine meditations', 'love'] },
  { from: 'four immeasurables', to: ['immeasurables'] },
  { from: 'contemplation of the body', to: ['mindfulness of the body'] },
  { from: 'body scan', to: ['mindfulness of the body'] },
  { from: 'breath meditation', to: ['mindfulness of breathing'] },
  { from: 'breathing meditation', to: ['mindfulness of breathing'] },
  { from: 'anapana', to: ['anapanassati'] },
  { from: 'loving-kindness meditation', to: ['meditation on love'] },
  { from: 'foulness', to: ['ugliness'] },
  { from: 'loathsomeness', to: ['ugliness'] },
  { from: 'corpse contemplation', to: ['charnel ground'] },
  { from: 'meditation object', to: ['meditation subject'] },
  { from: 'kasina', to: ['universal dimension'] },
  { from: 'kasinas', to: ['universal dimensions'] },
  { from: 'recollections', to: ['recollection'] },
  { from: 'enlightenment factors', to: ['awakening factors'] },
  { from: 'factors of enlightenment', to: ['awakening factors'] },
  { from: 'factors of awakening', to: ['awakening factors'] },
  { from: 'seven factors of awakening', to: ['awakening factors'] },
  { from: 'four right efforts', to: ['right efforts'] },
  { from: 'right exertion', to: ['right effort'] },
  { from: 'bases of psychic power', to: ['psychic power'] },
  { from: 'spiritual faculties', to: ['faculties'] },
  { from: 'five faculties', to: ['faculties'] },
  { from: 'five powers', to: ['powers'] },
  { from: 'requisites of awakening', to: ['bodhipakkhiya'] },
  { from: 'thirty-seven factors', to: ['bodhipakkhiya'] },
  { from: 'right intention', to: ['right thought'] },
  { from: 'right concentration', to: ['right composure'] },
  { from: 'right immersion', to: ['right composure'] },
  { from: 'path factor', to: ['atthangika'] },
  { from: 'middle path', to: ['middle way'] },
  { from: 'four noble truths', to: ['noble truth'] },
  { from: 'supernormal powers', to: ['psychic powers'] },
  { from: 'higher knowledges', to: ['direct knowledge'] },
  { from: 'divine eye', to: ['clairvoyance'] },
  { from: 'divine ear', to: ['clairaudience'] },
  { from: 'past lives', to: ['recollection of past lives'] },
  { from: 'stream entry', to: ['stream-enterer'] },
  { from: 'stream-entry', to: ['stream-enterer'] },
  { from: 'stream winner', to: ['stream-enterer'] },
  { from: 'once returner', to: ['once-returner'] },
  { from: 'non returner', to: ['non-returner'] },
  { from: 'fully enlightened', to: ['fully awakened'] },
  { from: 'self-awakened', to: ['awakened'] },
  { from: 'bodhisattva', to: ['bodhisatta'] },
  { from: 'sensation', to: ['feeling'] },
  { from: 'materiality', to: ['form'] },
  { from: 'alms round', to: ['almsround'] },
  { from: 'forest dwelling', to: ['wilderness'] },
];

// Sutta names — a discourse as readers name it to each other.
const SUTTA_NAMES: Expansion[] = [
  { from: 'the fire sermon', to: ['burning'] },
  { from: 'fire sermon', to: ['burning'] },
  { from: 'sigalovada', to: ['advice to sigalaka'] },
  { from: 'karaniya metta', to: ['discourse on love'] },
  { from: 'karaniyametta', to: ['discourse on love'] },
  { from: 'honeyball', to: ['the honey-cake'] },
  { from: 'honey ball', to: ['the honey-cake'] },
  { from: 'ant-hill', to: ['termite mound'] },
  { from: 'anthill', to: ['termite mound'] },
  { from: 'ants nest', to: ['termite mound'] },
  { from: "ant's nest", to: ['termite mound'] },
  { from: 'water snake', to: ['cobra'] },
  { from: 'poisoned arrow', to: ['arrow smeared with poison'] },
  { from: 'turning the wheel of dhamma', to: ['rolling forth the wheel of dhamma'] },
  { from: 'setting in motion the wheel of dhamma', to: ['rolling forth the wheel of dhamma'] },
  { from: 'discourse on the not-self characteristic', to: ['the characteristic of not-self'] },
  { from: 'satipatthana', to: ['establishment of mindfulness'] },
  { from: 'mahasatipatthana', to: ['establishment of mindfulness'] },

  // A discourse by its Pali name, where that name is not the Pali title this corpus carries.
  { from: 'kalama sutta', to: ['with the kalamas', 'kesamutti'] },
  { from: 'kalama', to: ['kalamas'] },
  { from: 'metta sutta', to: ['discourse on love'] },
  { from: 'mangala sutta', to: ['blessings', 'mangala'] },
  { from: 'ratana sutta', to: ['gems', 'ratana'] },
  { from: 'jewel discourse', to: ['gems', 'ratana'] },
  { from: 'dhammacakka', to: ['rolling forth the wheel of dhamma'] },
  { from: 'dhammacakkappavattana', to: ['rolling forth the wheel of dhamma'] },
  { from: 'first sermon', to: ['rolling forth the wheel of dhamma'] },
  { from: 'anattalakkhana', to: ['the characteristic of not-self'] },
  { from: 'anatta lakkhana', to: ['the characteristic of not-self'] },
  { from: 'adittapariyaya', to: ['burning'] },
  { from: 'aditta', to: ['burning'] },
  { from: 'alagaddupama', to: ['the simile of the cobra'] },
  { from: 'snake simile', to: ['the simile of the cobra'] },
  { from: 'simile of the snake', to: ['the simile of the cobra'] },
  { from: 'vammika', to: ['termite mound'] },
  { from: 'madhupindika', to: ['the honey-cake'] },
  { from: 'culamalunkya', to: ['the shorter discourse with malunkya'] },
  { from: 'cula malunkyaputta', to: ['the shorter discourse with malunkya'] },
  { from: 'arrow simile', to: ['arrow smeared with poison'] },
  { from: 'simile of the arrow', to: ['arrow smeared with poison'] },
  { from: 'kakacupama', to: ['the simile of the saw'] },
  { from: 'vatthupama', to: ['the simile of the cloth'] },
  { from: 'phenapindupama', to: ['foam'] },
  { from: 'foam simile', to: ['lump of foam'] },
  { from: 'agganna', to: ['what came first'] },
  { from: 'mahanidana', to: ['the great discourse on causation'] },
  { from: 'great discourse on causation', to: ['mahanidana'] },
  { from: 'mahaparinibbana', to: ['the great discourse on the buddha’s extinguishment'] },
  { from: 'sallekha', to: ['effacement'] },
  { from: 'kaccayanagotta', to: ['kaccanagotta'] },
  { from: 'kaccana', to: ['kaccanagotta'] },
  { from: 'bhaddekaratta', to: ['one fine night'] },
  { from: 'khaggavisana', to: ['horned rhino'] },
  { from: 'rhinoceros', to: ['horned rhino', 'khaggavisana'] },
  { from: 'rhinoceros horn', to: ['horned rhino', 'khaggavisana'] },
  { from: 'parayana', to:['the way to the far shore'] },
  { from: 'bhayabherava', to: ['fear and dread'] },
  { from: 'dvedhavitakka', to: ['two kinds of thought'] },
  { from: 'ambalatthika rahulovada', to: ['advice to rahula'] },
  { from: 'rahulovada', to: ['advice to rahula'] },
  { from: 'sigalaka', to: ['advice to sigalaka'] },
  { from: 'anathapindikovada', to: ['advice to anathapindika'] },
  { from: 'cakkavattisihanada', to: ['the wheel-turning monarch'] },
  { from: 'tevijja sutta', to: ['the three knowledges'] },
  { from: 'potthapada', to: ['with potthapada'] },
  { from: 'kevatta', to: ['with kevaddha'] },
  { from: 'kevaddha', to: ['with kevaddha'] },
  { from: 'kutadanta', to: ['with kutadanta'] },
  { from: 'sonadanda', to: ['with sonadanda'] },
  { from: 'samannaphala', to: ['the fruits of the ascetic life'] },
  { from: 'brahmajala', to: ['the divine net'] },
  { from: 'ariyapariyesana', to: ['the noble quest'] },
  { from: 'noble search', to: ['the noble quest'] },
  { from: 'anapanasati sutta', to: ['mindfulness of breathing', 'anapanassati'] },
  { from: 'kayagatasati', to: ['mindfulness of the body'] },
  { from: 'culahatthipadopama', to: ['the shorter simile of the elephant’s footprint'] },
  { from: 'mahahatthipadopama', to: ['the longer simile of the elephant’s footprint'] },
  { from: 'elephant footprint', to: ['elephant’s footprint'] },
  { from: 'vajira', to: ['with vajira'] },
  { from: 'chariot simile', to: ['with vajira'] },
  { from: 'bahiya', to: ['with bahiya'] },
  { from: 'angulimala', to:['with angulimala'] },
  { from: 'blind men and the elephant', to: ['nanatitthiya'] },
  { from: 'simile of the lute', to: ['the harp'] },
  { from: 'parable of the raft', to: ['simile of the raft'] },
  { from: 'burning house', to: ['burning'] },
  { from: 'salt crystal', to: ['a lump of salt'] },
  { from: 'simsapa', to: ['rosewood forest', 'sisapavana'] },
  { from: 'handful of leaves', to: ['rosewood forest', 'sisapavana'] },
];

// The table expandQuery walks, longest key first so the entry matching most of the query takes the
// slots before a single word inside it does. The sort is stable, so entries of equal key length
// keep the order they are written in and the `to` lists stay best-first.
export const QUERY_EXPANSIONS: Expansion[] = [...VOCABULARY, ...SUTTA_NAMES]
  .map(({ from, to }) => ({ from: searchKey(from), to: to.map(searchKey) }))
  .sort((a, b) => b.from.length - a.from.length);

const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;

// Matches an entry's phrase as whole words. `\b` is ASCII-only and would break on a Pali key, so
// the boundaries are the same lookarounds the matcher uses.
function phraseRe(from: string): RegExp {
  return new RegExp(`(?<!\\p{L})${from.replace(RE_ESCAPE, '\\$&')}(?!\\p{L})`, 'u');
}

// How many alternatives one query may add. Each costs a scan of both blobs, and past a handful the
// results stop being about what was typed.
export const MAX_EXPANSIONS = 4;

// The alternative queries `q` adds, `q` itself excluded. `q` must already be folded by searchKey.
export function expandQuery(q: string, limit = MAX_EXPANSIONS): string[] {
  const out: string[] = [];
  const matched: string[] = [];
  for (const { from, to } of QUERY_EXPANSIONS) {
    // The pattern is the key itself between two boundaries, so a query not containing the key
    // cannot match it. Checked before the regex, which is otherwise compiled for all 363 entries
    // on every keystroke.
    if (!q.includes(from)) continue;
    // A key inside a key that has already matched names the same part of the query, less
    // precisely: "hindrances" under "five hindrances". Substituting it there only produces the
    // half-replaced phrase the longer entry exists to avoid.
    if (matched.some((m) => m.includes(from))) continue;
    const re = phraseRe(from);
    if (!re.test(q)) continue;
    matched.push(from);
    for (const alt of to) {
      const expanded = q.replace(re, alt).replace(/\s+/g, ' ').trim();
      if (expanded && expanded !== q && !out.includes(expanded)) out.push(expanded);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
