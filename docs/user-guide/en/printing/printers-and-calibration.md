# Printers and calibration

**Who can do this:** Admin (adding printers). Anyone who prints picks a printer.

## Why do I choose the printer myself?

When you press Print, your browser opens its own print window where you pick a
printer. **SchoolManager cannot see which printer you pick there.** That is a
browser rule, and it protects your privacy.

But every printer prints a little differently: one shifts the picture 1 mm to
the right, another leaves a wider margin. SchoolManager can fix that, but only
if it knows the printer. So, **before** you print, you choose the same printer
in SchoolManager. It applies that printer's margins and corrections to the page.

Simple rule: **choose the same printer in SchoolManager and in the print window.**
SchoolManager remembers your last choice on this computer.

## Add a printer

1. Open **Settings → Printers** and press **Add printer**.
2. Give it a name people will recognise, for example "Front office card printer".
3. Choose the **type**:
   - **Card printer** — prints one card at a time, edge to edge.
   - **Office printer** — prints cards on A4 sheets that you cut out. It leaves a
     margin (5 mm is a good start) and a small gap between cards.
4. Choose how **both sides** are printed: **automatic both sides**, or **I turn
   the stack over by hand**.
5. Leave the offset at 0 and the scale at 1 for now. Press **Save**.

## Pre-printed card stock

If your school buys blank cards that already have the design printed on them,
you only need to print the name, photo and QR code. In the editor, open
**Files** and turn **off** "Print the background". The artwork still shows on
screen, but it will not print.

## Calibrate a printer (step by step)

Do this once for each printer, and again if you change the paper or card type.

1. In **Settings → Printers**, press **Print calibration page** next to the
   printer.
2. In the print window, set **Margins: None** and **Scale: 100%**. (If you see
   "Fit to page", turn it off.) Choose the same printer. Print.
3. Take a ruler. Measure from the **top-left corner of the paper** to the first
   **cross**. It should be **exactly 20 mm**.
4. Note the difference. A cross that is 1 mm too far **right** needs offset
   **X = −1**. A cross 0.5 mm too **low** needs **Y = −0.5**.
5. Press **Edit offset**, enter the numbers, and save.
6. Print the page again. The cross should now be at 20 mm. Repeat if not.

## Print window settings

Every time you print cards, set these in the browser's print window:

| Setting             | Value                                   |
| ------------------- | --------------------------------------- |
| Printer             | The same one you chose in SchoolManager |
| Margins             | **None**                                |
| Scale               | **100%** (not "fit to page")            |
| Headers and footers | Off                                     |
| Background graphics | On                                      |

## If something goes wrong

- **The print is shifted.** Calibrate again (above).
- **A white border on the card.** Office printers cannot print to the edge.
  Use a card printer, or add bleed in the design ([designer guide](designer-guide.md#3-safe-zone-and-bleed)).
- **Nothing opens when I press Print.** Your browser blocked the pop-up. Allow
  pop-ups for SchoolManager and try again.
