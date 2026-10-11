import { describe, expect, it } from 'vitest'
import {
  frequency,
  longestWord,
  parseIntField,
  stemWord,
  toCsv,
  toTsv,
  tokenizeWords,
  topTerms,
} from './wordfreq'

describe('tokenizeWords', () => {
  it('keeps apostrophes and hyphens inside words', () => {
    expect(tokenizeWords("don't stop well-known")).toEqual(["don't", 'stop', 'well-known'])
  })

  it('splits on punctuation and whitespace', () => {
    expect(tokenizeWords('one, two;three!\nfour')).toEqual(['one', 'two', 'three', 'four'])
  })

  it('keeps accented letters and digits', () => {
    expect(tokenizeWords('café 42')).toEqual(['café', '42'])
  })

  it('keeps non-Latin scripts intact', () => {
    expect(tokenizeWords('日本語 naïve Ω')).toEqual(['日本語', 'naïve', 'Ω'])
  })

  it('accepts the typographic apostrophe', () => {
    expect(tokenizeWords('don’t')).toEqual(['don’t'])
  })

  it('returns nothing for empty input', () => {
    expect(tokenizeWords('')).toEqual([])
  })
})

describe('stemWord', () => {
  it('folds plurals', () => {
    expect(stemWord('cats')).toBe('cat')
    expect(stemWord('boxes')).toBe('box')
    expect(stemWord('churches')).toBe('church')
    expect(stemWord('dishes')).toBe('dish')
    expect(stemWord('parties')).toBe('party')
  })

  it('leaves double-s and short words alone', () => {
    expect(stemWord('class')).toBe('class')
    expect(stemWord('gas')).toBe('gas')
    expect(stemWord('bus')).toBe('bus')
    expect(stemWord('as')).toBe('as')
  })

  it('strips possessives before plural endings', () => {
    expect(stemWord("cat's")).toBe('cat')
  })

  it('folds simple verb endings and undoubles the stem', () => {
    expect(stemWord('running')).toBe('run')
    expect(stemWord('walked')).toBe('walk')
    expect(stemWord('hopped')).toBe('hop')
    expect(stemWord('added')).toBe('add')
  })

  it('leaves a doubled l, s or z alone', () => {
    expect(stemWord('calling')).toBe('call')
    expect(stemWord('passed')).toBe('pass')
    expect(stemWord('buzzed')).toBe('buzz')
  })

  it('never undoubles a three-letter stem into two', () => {
    expect(stemWord('adding')).toBe('add')
    expect(stemWord('added')).toBe('add')
  })
})

describe('frequency', () => {
  it('counts words case-insensitively by default', () => {
    const report = frequency('the Cat cat CAT dog')
    expect(report.totalWords).toBe(5)
    expect(report.uniqueWords).toBe(3)
    expect(report.entries[0]).toEqual({ term: 'cat', count: 3, percent: 60 })
  })

  it('honours case sensitivity', () => {
    const report = frequency('Cat cat', { caseSensitive: true })
    expect(report.uniqueWords).toBe(2)
  })

  it('drops short words when a minimum is set', () => {
    const report = frequency('a bb ccc dddd', { minLength: 3 })
    expect(report.entries.map((entry) => entry.term)).toEqual(['ccc', 'dddd'])
  })

  it('removes stop words on request', () => {
    const withStop = frequency('the cat and the dog')
    expect(withStop.entries.some((entry) => entry.term === 'the')).toBe(true)
    const without = frequency('the cat and the dog', { ignoreStopWords: true })
    expect(without.entries.some((entry) => entry.term === 'the')).toBe(false)
  })

  it('drops number-only tokens on request', () => {
    const report = frequency('2024 report 2024', { ignoreNumbers: true })
    expect(report.entries.map((entry) => entry.term)).toEqual(['report'])
    expect(report.totalWords).toBe(1)
  })

  it('keeps alphanumeric tokens when numbers are ignored', () => {
    const report = frequency('mp3 mp3', { ignoreNumbers: true })
    expect(report.entries[0].term).toBe('mp3')
  })

  it('folds plural forms when stemming is on', () => {
    const report = frequency('cat cats cat', { stem: true })
    expect(report.entries).toEqual([{ term: 'cat', count: 3, percent: 100 }])
  })

  it('builds bigrams and trigrams', () => {
    const report = frequency('new york city new york', { ngramSize: 2 })
    expect(report.entries[0]).toEqual({ term: 'new york', count: 2, percent: (2 / 4) * 100 })
  })

  it('does not let an n-gram span punctuation', () => {
    // "end. next" is not a phrase, so only "next pair" is a bigram.
    const report = frequency('end. next pair', { ngramSize: 2 })
    expect(report.entries.map((entry) => entry.term)).toEqual(['next pair'])
  })

  it('does not let an n-gram span a newline', () => {
    const report = frequency('alpha\nbeta gamma', { ngramSize: 2 })
    expect(report.entries.map((entry) => entry.term)).toEqual(['beta gamma'])
  })

  it('lets an n-gram cross an apostrophe', () => {
    const report = frequency("rock 'n' roll", { ngramSize: 2 })
    expect(report.entries.map((entry) => entry.term).sort()).toEqual(['n roll', 'rock n'])
  })

  it('does not build a phrase across a removed stop word', () => {
    const report = frequency('statue of liberty', { ngramSize: 2, ignoreStopWords: true })
    expect(report.entries).toEqual([])
  })

  it('clamps the n-gram size to a usable range', () => {
    expect(frequency('a b c d e f', { ngramSize: 99 }).entries[0].term.split(' ')).toHaveLength(5)
    expect(frequency('a b c', { ngramSize: 0 }).entries[0].term).toBe('a')
  })

  it('caps the number of entries', () => {
    const report = frequency('a b c d e f', { top: 2 })
    expect(report.entries).toHaveLength(2)
  })

  it('reports the uncapped distinct count even when the list is capped', () => {
    const report = frequency('a b c d e f', { top: 2 })
    expect(report.uniqueWords).toBe(6)
    expect(report.entries).toHaveLength(2)
  })

  it('breaks ties alphabetically', () => {
    const report = frequency('b a c')
    expect(report.entries.map((entry) => entry.term)).toEqual(['a', 'b', 'c'])
  })

  it('handles empty input', () => {
    const report = frequency('')
    expect(report).toEqual({ totalWords: 0, uniqueWords: 0, totalTerms: 0, entries: [] })
  })

  it('handles whitespace-only and punctuation-only input', () => {
    expect(frequency('   \n\t ').entries).toEqual([])
    expect(frequency('!!! ...').entries).toEqual([])
  })

  it('keeps a lone n-gram shorter than the requested size out of the result', () => {
    const report = frequency('solo', { ngramSize: 2 })
    expect(report.entries).toEqual([])
  })

  it('counts every n-gram position, so totalTerms exceeds uniqueWords', () => {
    const report = frequency('a b c d', { ngramSize: 3 })
    expect(report.uniqueWords).toBe(2)
    expect(report.totalTerms).toBe(2)
    const repeated = frequency('a b c a b c', { ngramSize: 3 })
    expect(repeated.uniqueWords).toBe(3)
    expect(repeated.totalTerms).toBe(4)
    expect(repeated.entries[0]).toEqual({ term: 'a b c', count: 2, percent: 50 })
  })

  it('treats a top larger than the result as no cap', () => {
    const report = frequency('a b', { top: 50 })
    expect(report.entries).toHaveLength(2)
  })

  it('sorts alphabetically on request, still capped by top', () => {
    const report = frequency('b b a c c c', { sort: 'alpha' })
    expect(report.entries.map((entry) => entry.term)).toEqual(['a', 'b', 'c'])
    expect(report.entries[0].count).toBe(1)
    expect(frequency('b b a c c c', { sort: 'alpha', top: 2 }).entries.map((entry) => entry.term)).toEqual(['a', 'b'])
  })

  it('breaks count ties alphabetically, whichever order is asked for', () => {
    expect(frequency('b a c a b c').entries.map((entry) => entry.term)).toEqual(['a', 'b', 'c'])
    expect(frequency('c b a', { sort: 'alpha' }).entries.map((entry) => entry.term)).toEqual(['a', 'b', 'c'])
  })

  it('percentages of every term add up to 100', () => {
    const report = frequency('a a b c')
    const sum = report.entries.reduce((total, entry) => total + entry.percent, 0)
    expect(sum).toBeCloseTo(100, 6)
  })

  it('counts a large paste without dropping terms', () => {
    const text = Array.from({ length: 20_000 }, (_, index) => `word${index % 1000}`).join(' ')
    const report = frequency(text)
    expect(report.totalWords).toBe(20_000)
    expect(report.uniqueWords).toBe(1000)
    expect(report.entries[0].count).toBe(20)
  })

  it('handles astral and combining characters as single tokens', () => {
    expect(tokenizeWords('👋 café 日本')).toEqual(['café', '日本'])
    expect(frequency('café café').entries[0]).toEqual({ term: 'café', count: 2, percent: 100 })
  })
})

describe('topTerms', () => {
  it('returns the ranked terms', () => {
    expect(topTerms('b b a')).toEqual(['b', 'a'])
  })
})

describe('exporters', () => {
  const entries = frequency('cat cat dog', { caseSensitive: true }).entries

  it('writes TSV with a percent sign', () => {
    expect(toTsv(entries)).toBe('cat\t2\t66.67%\ndog\t1\t33.33%')
  })

  it('writes CSV with a header', () => {
    const csv = toCsv(frequency('cat cat dog').entries)
    expect(csv.split('\n')[0]).toBe('term,count,percent')
    expect(csv.split('\n')[1]).toBe('cat,2,66.6667')
  })

  it('writes a header-only CSV and an empty TSV for no terms', () => {
    expect(toCsv([])).toBe('term,count,percent')
    expect(toTsv([])).toBe('')
  })

  it('quotes a CSV term that contains a comma', () => {
    expect(toCsv([{ term: 'a,b', count: 1, percent: 100 }]).split('\n')[1]).toBe('"a,b",1,100.0000')
  })
})

describe('longestWord', () => {
  it('finds the longest token', () => {
    expect(longestWord('a bb ccc')).toBe('ccc')
    expect(longestWord('')).toBe('')
  })
})

describe('parseIntField', () => {
  it('accepts a value inside the range', () => {
    expect(parseIntField('12', 5, 1, 200)).toEqual({ value: 12, invalid: false })
  })

  it('falls back silently on empty or whitespace', () => {
    expect(parseIntField('', 7, 1, 200)).toEqual({ value: 7, invalid: false })
    expect(parseIntField('   ', 7, 1, 200)).toEqual({ value: 7, invalid: false })
  })

  it('flags and clamps a value out of range', () => {
    expect(parseIntField('0', 1, 1, 200)).toEqual({ value: 1, invalid: true })
    expect(parseIntField('999', 1, 1, 200)).toEqual({ value: 200, invalid: true })
    expect(parseIntField('-5', 0, 0, 100)).toEqual({ value: 0, invalid: true })
  })

  it('flags a value that is not a whole number', () => {
    expect(parseIntField('2.5', 1, 1, 200)).toEqual({ value: 2, invalid: true })
    expect(parseIntField('abc', 1, 1, 200)).toEqual({ value: 1, invalid: true })
    expect(parseIntField('NaN', 1, 1, 200)).toEqual({ value: 1, invalid: true })
  })
})
