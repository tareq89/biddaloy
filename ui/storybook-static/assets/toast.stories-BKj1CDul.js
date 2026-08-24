import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{within as n,userEvent as c}from"./index-DH-M5T-F.js";import{B as i}from"./button-CSdgWkZr.js";import{t as u,T as b}from"./toast-CnHbGad_.js";import"./button-DtSgWxv7.js";import"./utils-DCADjnpI.js";import"./index-xLXNAgRb.js";import"./index-UiW3gZKV.js";import"./_commonjsHelpers-CqkleIqs.js";import"./createLucideIcon-xFpSlqfg.js";import"./index-3b7XovMV.js";import"./index-BA8NevWa.js";const _={title:"Components/Toast",tags:["autodocs"],decorators:[t=>e.jsxs(e.Fragment,{children:[e.jsx(t,{}),e.jsx(b,{})]})]},s={render:()=>e.jsx(i,{type:"button",onClick:()=>u("Fee structure created"),children:"Show toast"}),play:async({canvasElement:t})=>{const a=n(t);await c.click(a.getByRole("button",{name:"Show toast"}))}},r={render:()=>e.jsx(i,{type:"button",onClick:()=>u.success("Payment recorded"),children:"Show success toast"}),play:async({canvasElement:t})=>{const a=n(t);await c.click(a.getByRole("button",{name:"Show success toast"}))}},o={render:()=>e.jsx(i,{type:"button",onClick:()=>u.error("Failed to record payment"),children:"Show error toast"}),play:async({canvasElement:t})=>{const a=n(t);await c.click(a.getByRole("button",{name:"Show error toast"}))}};var m,p,l;s.parameters={...s.parameters,docs:{...(m=s.parameters)==null?void 0:m.docs,source:{originalSource:`{
  render: () => <Button type="button" onClick={() => toast('Fee structure created')}>
      Show toast
    </Button>,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', {
      name: 'Show toast'
    }));
  }
}`,...(l=(p=s.parameters)==null?void 0:p.docs)==null?void 0:l.source}}};var d,y,w;r.parameters={...r.parameters,docs:{...(d=r.parameters)==null?void 0:d.docs,source:{originalSource:`{
  render: () => <Button type="button" onClick={() => toast.success('Payment recorded')}>
      Show success toast
    </Button>,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', {
      name: 'Show success toast'
    }));
  }
}`,...(w=(y=r.parameters)==null?void 0:y.docs)==null?void 0:w.source}}};var h,v,S,E,B;o.parameters={...o.parameters,docs:{...(h=o.parameters)==null?void 0:h.docs,source:{originalSource:`{
  render: () => <Button type="button" onClick={() => toast.error('Failed to record payment')}>
      Show error toast
    </Button>,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', {
      name: 'Show error toast'
    }));
  }
}`,...(S=(v=o.parameters)==null?void 0:v.docs)==null?void 0:S.source},description:{story:`Stands in for this issue's "error" state category.`,...(B=(E=o.parameters)==null?void 0:E.docs)==null?void 0:B.description}}};const O=["Default","SuccessVariant","ErrorVariant"];export{s as Default,o as ErrorVariant,r as SuccessVariant,O as __namedExportsOrder,_ as default};
