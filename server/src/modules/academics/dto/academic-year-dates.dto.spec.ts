import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAcademicYearDto } from './create-academic-year.dto';

// [2659] A bare @IsDateString accepts 2018-02-30; Postgres then 500s.
describe('CreateAcademicYearDto dates', () => {
  const check = (start_date: string, end_date: string) =>
    validate(plainToInstance(CreateAcademicYearDto, { name: 'Y', start_date, end_date }));

  it('rejects a date that does not exist', async () => {
    const errors = await check('2018-02-30', '2018-12-31');
    expect(errors.map((e) => e.property)).toContain('start_date');
  });

  it('accepts real dates', async () => {
    expect(await check('2018-01-01', '2018-12-31')).toEqual([]);
  });
});
