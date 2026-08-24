import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{within as u,userEvent as q,expect as K}from"./index-DH-M5T-F.js";import{r as M}from"./rtl-decorator-oYb0FejH.js";import{B as n}from"./button-CSdgWkZr.js";import{D as r,a as s,b as l,c,d,e as D,f as x,g as Q}from"./dialog-DT9v9mtx.js";import"./index-UiW3gZKV.js";import"./_commonjsHelpers-CqkleIqs.js";import"./button-DtSgWxv7.js";import"./utils-DCADjnpI.js";import"./index-xLXNAgRb.js";import"./createLucideIcon-xFpSlqfg.js";import"./index-DpBxWE_S.js";import"./index-BYSY9Ylb.js";import"./index-PfDNeppy.js";import"./index-CbhEr7yb.js";import"./index-3b7XovMV.js";import"./index-BA8NevWa.js";import"./index-Bl6Aqj_e.js";const me={title:"Components/Dialog",component:r,tags:["autodocs"]};function G({loading:a=!1}){return e.jsxs(r,{children:[e.jsx(s,{asChild:!0,children:e.jsx(n,{children:"Record payment"})}),e.jsxs(l,{children:[e.jsxs(c,{children:[e.jsx(d,{children:"Record a payment"}),e.jsx(x,{children:"Enter the amount received for this invoice."})]}),e.jsx("input",{"aria-label":"Amount",placeholder:"0.00"}),e.jsxs(D,{children:[e.jsx(Q,{asChild:!0,children:e.jsx(n,{variant:"outline",children:"Cancel"})}),e.jsx(n,{loading:a,children:"Confirm"})]})]})]})}const g={render:()=>e.jsx(G,{}),play:async({canvasElement:a})=>{const h=u(a);await q.click(h.getByRole("button",{name:"Record payment"}));const J=u(a.ownerDocument.body).getByRole("dialog");await K(u(J).getByRole("heading",{name:"Record a payment"})).toBeInTheDocument()}},m={name:"Loading (confirm in flight)",render:()=>e.jsx(G,{loading:!0}),play:async({canvasElement:a})=>{const h=u(a);await q.click(h.getByRole("button",{name:"Record payment"}))}},t={render:()=>e.jsxs(r,{children:[e.jsx(s,{asChild:!0,children:e.jsx(n,{children:"Confirm sign out"})}),e.jsxs(l,{children:[e.jsx(c,{children:e.jsx(d,{children:"Sign out?"})}),e.jsx(D,{showCloseButton:!0,children:e.jsx(n,{variant:"destructive",children:"Sign out"})})]})]})},o={render:()=>e.jsxs(r,{defaultOpen:!0,children:[e.jsx(s,{asChild:!0,children:e.jsx(n,{children:"Record payment"})}),e.jsxs(l,{children:[e.jsxs(c,{children:[e.jsx(d,{children:"Record a payment"}),e.jsx(x,{children:"Enter the amount received for this invoice."})]}),e.jsx("input",{"aria-label":"Amount","aria-invalid":!0,defaultValue:"-50"}),e.jsx("p",{role:"alert",className:"text-sm text-destructive",children:"Amount must be greater than zero."}),e.jsx(D,{children:e.jsx(n,{children:"Confirm"})})]})]})},i={render:()=>e.jsxs(r,{children:[e.jsx(s,{asChild:!0,children:e.jsx(n,{disabled:!0,children:"Record payment"})}),e.jsx(l,{children:e.jsx(c,{children:e.jsx(d,{children:"Record a payment"})})})]})},p={render:()=>e.jsxs(r,{defaultOpen:!0,children:[e.jsx(s,{asChild:!0,children:e.jsx(n,{children:"পেমেন্ট রেকর্ড করুন"})}),e.jsxs(l,{children:[e.jsxs(c,{children:[e.jsx(d,{children:"একটি পেমেন্ট রেকর্ড করুন"}),e.jsx(x,{children:"প্রাপ্ত পরিমাণ লিখুন।"})]}),e.jsx("input",{"aria-label":"পরিমাণ",placeholder:"০.০০"})]})]}),decorators:[M]};var y,j,f;g.parameters={...g.parameters,docs:{...(y=g.parameters)==null?void 0:y.docs,source:{originalSource:`{
  render: () => <RecordPaymentDialog />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', {
      name: 'Record payment'
    }));
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog');
    await expect(within(dialog).getByRole('heading', {
      name: 'Record a payment'
    })).toBeInTheDocument();
  }
}`,...(f=(j=g.parameters)==null?void 0:j.docs)==null?void 0:f.source}}};var v,R,C;m.parameters={...m.parameters,docs:{...(v=m.parameters)==null?void 0:v.docs,source:{originalSource:`{
  name: 'Loading (confirm in flight)',
  render: () => <RecordPaymentDialog loading />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', {
      name: 'Record payment'
    }));
  }
}`,...(C=(R=m.parameters)==null?void 0:R.docs)==null?void 0:C.source}}};var B,T,b,w,E;t.parameters={...t.parameters,docs:{...(B=t.parameters)==null?void 0:B.docs,source:{originalSource:`{
  render: () => <Dialog>
      <DialogTrigger asChild>
        <Button>Confirm sign out</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign out?</DialogTitle>
        </DialogHeader>
        <DialogFooter showCloseButton>
          <Button variant="destructive">Sign out</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
}`,...(b=(T=t.parameters)==null?void 0:T.docs)==null?void 0:b.source},description:{story:`Stands in for this issue's "empty" state category — a dialog with no
description or secondary actions, the minimal real dialog shape.`,...(E=(w=t.parameters)==null?void 0:w.docs)==null?void 0:E.description}}};var S,H,L,A,F;o.parameters={...o.parameters,docs:{...(S=o.parameters)==null?void 0:S.docs,source:{originalSource:`{
  render: () => <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button>Record payment</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>Enter the amount received for this invoice.</DialogDescription>
        </DialogHeader>
        <input aria-label="Amount" aria-invalid defaultValue="-50" />
        <p role="alert" className="text-sm text-destructive">
          Amount must be greater than zero.
        </p>
        <DialogFooter>
          <Button>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
}`,...(L=(H=o.parameters)==null?void 0:H.docs)==null?void 0:L.source},description:{story:`Stands in for this issue's "error" state category.`,...(F=(A=o.parameters)==null?void 0:A.docs)==null?void 0:F.description}}};var O,k,P,z,I;i.parameters={...i.parameters,docs:{...(O=i.parameters)==null?void 0:O.docs,source:{originalSource:`{
  render: () => <Dialog>
      <DialogTrigger asChild>
        <Button disabled>Record payment</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
        </DialogHeader>
      </DialogContent>
    </Dialog>
}`,...(P=(k=i.parameters)==null?void 0:k.docs)==null?void 0:P.source},description:{story:`\`Disabled\` doesn't apply to a dialog itself (only to controls inside
it, already covered by \`Button\`'s own \`Disabled\` story) — a dialog is
either open or not, there's no third "disabled" state of the dialog as
a whole. This story instead shows the trigger disabled, which is the
realistic call site for "disabled dialog".`,...(I=(z=i.parameters)==null?void 0:z.docs)==null?void 0:I.description}}};var N,V,_;p.parameters={...p.parameters,docs:{...(N=p.parameters)==null?void 0:N.docs,source:{originalSource:`{
  render: () => <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button>পেমেন্ট রেকর্ড করুন</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>একটি পেমেন্ট রেকর্ড করুন</DialogTitle>
          <DialogDescription>প্রাপ্ত পরিমাণ লিখুন।</DialogDescription>
        </DialogHeader>
        <input aria-label="পরিমাণ" placeholder="০.০০" />
      </DialogContent>
    </Dialog>,
  decorators: [rtlDecorator]
}`,...(_=(V=p.parameters)==null?void 0:V.docs)==null?void 0:_.source}}};const pe=["Default","Loading","Empty","ErrorState","TriggerDisabled","RightToLeft"];export{g as Default,t as Empty,o as ErrorState,m as Loading,p as RightToLeft,i as TriggerDisabled,pe as __namedExportsOrder,me as default};
