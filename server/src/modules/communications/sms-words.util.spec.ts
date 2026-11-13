import { smsWord } from './sms-words.util';

describe('smsWord', () => {
  const labels = { guardian: { en: { one: 'Parent', other: 'Parents' }, bn: 'পিতামাতা' } };

  it('picks en one/other and the single bn word', () => {
    expect(smsWord(labels, 'guardian', 'en', 'Guardian')).toBe('Parent');
    expect(smsWord(labels, 'guardian', 'en', 'Guardians', true)).toBe('Parents');
    expect(smsWord(labels, 'guardian', 'bn', 'অভিভাবক', true)).toBe('পিতামাতা');
  });

  it('keeps the stock word when unset, blank or partial', () => {
    expect(smsWord(undefined, 'guardian', 'en', 'Guardian')).toBe('Guardian');
    expect(smsWord({ guardian: { bn: '  ' } }, 'guardian', 'bn', 'অভিভাবক')).toBe('অভিভাবক');
    expect(
      smsWord({ guardian: { en: { one: 'Parent' } } }, 'guardian', 'en', 'Guardians', true),
    ).toBe('Guardians');
    expect(smsWord(labels, 'teacher', 'en', 'Teacher')).toBe('Teacher');
  });

  it('drops braces so a word can never form a {{placeholder}}', () => {
    const w = { guardian: { en: { one: 'P{{student_name}}' } } };
    expect(smsWord(w, 'guardian', 'en', 'Guardian')).toBe('Pstudent_name');
  });

  it('strips control characters and newlines so a word stays one token', () => {
    const evil = { guardian: { en: { one: 'Par\nent\r\n http://x\u0007' } } };
    expect(smsWord(evil, 'guardian', 'en', 'Guardian')).toBe('Par ent http://x');
    expect(smsWord({ guardian: { en: { one: '\n\t' } } }, 'guardian', 'en', 'Guardian')).toBe(
      'Guardian',
    );
  });
});
