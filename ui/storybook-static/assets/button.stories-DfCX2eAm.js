import{j as I}from"./jsx-runtime-D_zvdyIk.js";import{within as _,userEvent as q,expect as C}from"./index-DH-M5T-F.js";import{r as N}from"./rtl-decorator-oYb0FejH.js";import{B as z}from"./button-CSdgWkZr.js";import"./index-UiW3gZKV.js";import"./_commonjsHelpers-CqkleIqs.js";import"./button-DtSgWxv7.js";import"./utils-DCADjnpI.js";import"./index-xLXNAgRb.js";import"./createLucideIcon-xFpSlqfg.js";const W={title:"Components/Button",component:z,tags:["autodocs"],args:{children:"Save changes"}},s={play:async({canvasElement:k})=>{const n=_(k).getByRole("button",{name:"Save changes"});await q.click(n),await C(n).toBeEnabled()}},a={args:{loading:!0}},o={args:{disabled:!0}},e={args:{iconOnly:!0,"aria-label":"Delete row",children:I.jsx("span",{"aria-hidden":"true",children:"×"})}},r={args:{variant:"destructive",children:"Delete student record"}},t={decorators:[N]};var c,i,d;s.parameters={...s.parameters,docs:{...(c=s.parameters)==null?void 0:c.docs,source:{originalSource:`{
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', {
      name: 'Save changes'
    });
    await userEvent.click(button);
    await expect(button).toBeEnabled();
  }
}`,...(d=(i=s.parameters)==null?void 0:i.docs)==null?void 0:d.source}}};var l,p,u;a.parameters={...a.parameters,docs:{...(l=a.parameters)==null?void 0:l.docs,source:{originalSource:`{
  args: {
    loading: true
  }
}`,...(u=(p=a.parameters)==null?void 0:p.docs)==null?void 0:u.source}}};var m,g,h;o.parameters={...o.parameters,docs:{...(m=o.parameters)==null?void 0:m.docs,source:{originalSource:`{
  args: {
    disabled: true
  }
}`,...(h=(g=o.parameters)==null?void 0:g.docs)==null?void 0:h.source}}};var y,b,v,f,w;e.parameters={...e.parameters,docs:{...(y=e.parameters)==null?void 0:y.docs,source:{originalSource:`{
  args: {
    iconOnly: true,
    'aria-label': 'Delete row',
    children: <span aria-hidden="true">×</span>
  }
}`,...(v=(b=e.parameters)==null?void 0:b.docs)==null?void 0:v.source},description:{story:`Stands in for this issue's "empty" state category — an icon-only button
has no visible label, the closest analog \`Button\` has to "empty". The
\`aria-label\` is required by the type; try removing it in this story's
args to see the compile error the wrapper's job is to produce.`,...(w=(f=e.parameters)==null?void 0:f.docs)==null?void 0:w.description}}};var E,S,x,D,B;r.parameters={...r.parameters,docs:{...(E=r.parameters)==null?void 0:E.docs,source:{originalSource:`{
  args: {
    variant: 'destructive',
    children: 'Delete student record'
  }
}`,...(x=(S=r.parameters)==null?void 0:S.docs)==null?void 0:x.source},description:{story:`Stands in for this issue's "error" state category — \`destructive\` is
this design system's error/danger variant.`,...(B=(D=r.parameters)==null?void 0:D.docs)==null?void 0:B.description}}};var R,L,O,T,j;t.parameters={...t.parameters,docs:{...(R=t.parameters)==null?void 0:R.docs,source:{originalSource:`{
  decorators: [rtlDecorator]
}`,...(O=(L=t.parameters)==null?void 0:L.docs)==null?void 0:O.source},description:{story:"Neither of this package's two supported locales (`en`, `bn`) is RTL —\nsee `.storybook/locale.tsx` — so this forces `dir=\"rtl\"` directly rather\nthan switching locale, to prove the component's own layout (icon/label\norder, focus ring, spacing) holds up under a bidi flip regardless of\nwhether a real RTL locale exists yet.",...(j=(T=t.parameters)==null?void 0:T.docs)==null?void 0:j.description}}};const X=["Default","Loading","Disabled","IconOnly","Error","RightToLeft"];export{s as Default,o as Disabled,r as Error,e as IconOnly,a as Loading,t as RightToLeft,X as __namedExportsOrder,W as default};
