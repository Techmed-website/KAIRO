import type { SubjectCode } from '../types';

/** Blueprint subject slug → KAIRO subject code. */
export const SLUG_CODE: Record<string, SubjectCode> = { 'use-of-english': 'ENG', mathematics: 'MTH', physics: 'PHY', chemistry: 'CHM', biology: 'BIO' };

/**
 * Blueprint topic title → KAIRO question-bank topic ids (cbt.topics), matched by hand on 26 Nov 2026.
 * The two lists are worded differently ("Kinetic Theory & Gas Laws" vs "Kinetic theory of matter and Gas Laws"),
 * so this is explicit rather than guessed. A title with no entry has no matching topic in the bank yet:
 * the app falls back to practice from the whole subject.
 */
const MAP: Record<string, Record<string, number[]>> = {
  chemistry: {
    'Separation of Mixtures & Purification': [98], 'Chemical Combination': [110], 'Kinetic Theory & Gas Laws': [104],
    'Atomic Structure & Bonding': [111], Air: [112], Water: [96], Solubility: [97], 'Environmental Pollution': [105],
    'Acids, Bases & Salts': [113], 'Oxidation & Reduction': [100], Electrolysis: [107], 'Energy Changes': [106],
    'Rates of Chemical Reaction': [99], 'Chemical Equilibrium': [109], 'Non-metals & Their Compounds': [102],
    'Metals & Their Compounds': [103], 'Organic Compounds': [101], 'Chemistry & Industry': [108],
  },
  physics: {
    'Measurements & Units': [73], 'Scalars & Vectors': [64], Motion: [72], 'Gravitational Field': [79], 'Equilibrium of Forces': [82],
    'Work, Energy & Power': [57], Friction: [81], 'Simple Machines': [62], Elasticity: [90], Pressure: [69], 'Liquids at Rest': [75],
    Temperature: [61], 'Thermal Expansion': [60], 'Gas Laws': [80], 'Quantity of Heat': [67], 'Change of State': [93], Vapours: [59],
    'Structure of Matter & Kinetic Theory': [77], 'Heat Transfer': [78], Waves: [58], 'Propagation of Sound': [68],
    'Characteristics of Sound': [68], 'Light Energy': [76], Reflection: [66], Refraction: [65], 'Optical Instruments': [70],
    'Dispersion & Electromagnetic Spectrum': [91], Electrostatics: [85], Capacitors: [94], 'Electric Cells': [89],
    'Current Electricity': [92, 87], 'Electrical Energy & Power': [88], 'Magnets & Magnetic Fields': [74],
    'Force on Current-Carrying Conductors': [74], 'Electromagnetic Induction': [86], 'A.C. Circuits': [95], Electronics: [63],
    'Atomic & Nuclear Physics': [71, 83, 84],
  },
  biology: {
    'Living Organisms': [127], 'Evolution Among Taxonomic Groups': [134], 'Variety of Organisms': [120],
    'Internal Structure of Flowering Plants & Mammals': [128], Nutrition: [124], Transport: [115], Respiration: [122], Excretion: [133],
    'Support & Movement': [119], Reproduction: [123], Growth: [131], 'Coordination & Control': [136],
    'Factors Affecting Distribution': [132], 'Symbiotic Interactions & Energy Flow': [118], 'Natural Habitats': [125],
    'Local Nigerian Biomes': [126], 'Ecology of Populations': [117], Soil: [121], 'Humans & Environment': [129],
    'Variation in Population': [114], Heredity: [130], 'Theories & Evidence of Evolution': [116, 135],
  },
  mathematics: {
    'Number Bases': [34], 'Fractions, Decimals, Approximations & Percentages': [46, 33], 'Indices, Logarithms & Surds': [43, 39, 25],
    Sets: [27], Polynomials: [30, 47, 28, 26, 56], Inequalities: [42], Progression: [53, 45], 'Binary Operations': [52],
    'Matrices & Determinants': [38], 'Euclidean Geometry': [24, 31, 51], Mensuration: [35], Loci: [40], 'Coordinate Geometry': [50],
    Trigonometry: [22, 23, 44], Differentiation: [48], 'Application of Differentiation': [55], Integration: [41, 54],
    'Representation of Data': [49], 'Measures of Location': [37], 'Measures of Dispersion': [36], 'Permutation & Combination': [32],
    Probability: [29],
  },
  'use-of-english': {
    Comprehension: [19], Summary: [19], 'Main Ideas': [19], 'Implied Meaning': [19], "Writer's Attitude": [19], Inference: [19],
    'Logical Reasoning': [20], Synonyms: [7], Antonyms: [7], Idioms: [14], 'Figurative Meaning': [3, 14], 'Contextual Meaning': [3],
    'Lexical Relationships': [4, 21], 'Word Classes': [16], 'Sentence Patterns': [9, 16], Clauses: [16], Concord: [16, 17],
    Tense: [16], Aspect: [16], Mood: [16], Agreement: [16, 17], 'Question Tags': [16], 'Sentence Completion': [10],
    'Sentence Interpretation': [3], Vowels: [2], Diphthongs: [2], Consonants: [18], 'Consonant Clusters': [18], Homophones: [11],
    Stress: [8], Intonation: [13], 'Required Reading Text': [5],
  },
};

export function kairoTopics(subjectSlug: string, title: string): number[] {
  return MAP[subjectSlug]?.[title] ?? [];
}
