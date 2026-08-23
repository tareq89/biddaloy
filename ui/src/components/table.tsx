import * as React from 'react';

import {
  Table as TablePrimitive,
  TableBody as TableBodyPrimitive,
  TableCaption as TableCaptionPrimitive,
  TableCell as TableCellPrimitive,
  TableFooter as TableFooterPrimitive,
  TableHead as TableHeadPrimitive,
  TableHeader as TableHeaderPrimitive,
  TableRow as TableRowPrimitive,
} from '../primitives/table';

/**
 * The plain, static table — no sorting, no pagination, no roving
 * tabindex, no persisted column state. `DataTable` ([8.9.4]) owns all of
 * that for a list page's main grid; this is for the small, fixed-shape
 * tables a detail page's tabs render (a student's enrolment history, fee
 * breakdown, payment history) where every row is already loaded and
 * nothing about the table itself is interactive. Reach for `DataTable`
 * first — this exists for the cases where its sort/pagination/column-menu
 * machinery would be pure unused overhead.
 */
export type TableProps = React.ComponentProps<typeof TablePrimitive>;
export type TableHeaderProps = React.ComponentProps<typeof TableHeaderPrimitive>;
export type TableBodyProps = React.ComponentProps<typeof TableBodyPrimitive>;
export type TableFooterProps = React.ComponentProps<typeof TableFooterPrimitive>;
export type TableRowProps = React.ComponentProps<typeof TableRowPrimitive>;
export type TableHeadProps = React.ComponentProps<typeof TableHeadPrimitive>;
export type TableCellProps = React.ComponentProps<typeof TableCellPrimitive>;
export type TableCaptionProps = React.ComponentProps<typeof TableCaptionPrimitive>;

export function Table(props: TableProps) {
  return <TablePrimitive {...props} />;
}

export function TableHeader(props: TableHeaderProps) {
  return <TableHeaderPrimitive {...props} />;
}

export function TableBody(props: TableBodyProps) {
  return <TableBodyPrimitive {...props} />;
}

export function TableFooter(props: TableFooterProps) {
  return <TableFooterPrimitive {...props} />;
}

export function TableRow(props: TableRowProps) {
  return <TableRowPrimitive {...props} />;
}

export function TableHead(props: TableHeadProps) {
  return <TableHeadPrimitive {...props} />;
}

export function TableCell(props: TableCellProps) {
  return <TableCellPrimitive {...props} />;
}

export function TableCaption(props: TableCaptionProps) {
  return <TableCaptionPrimitive {...props} />;
}
