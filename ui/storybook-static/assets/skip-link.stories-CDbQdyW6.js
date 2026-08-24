import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r as l}from"./rtl-decorator-oYb0FejH.js";import{S as t}from"./skip-link-DQLnI2o8.js";import"./index-UiW3gZKV.js";import"./_commonjsHelpers-CqkleIqs.js";const f={title:"Components/SkipLink",component:t,tags:["autodocs"],args:{targetId:"story-main-content",children:"Skip to main content"},parameters:{docs:{description:{component:"Visually hidden until it receives keyboard focus — press Tab from the canvas to reveal it."}}}},r={render:n=>e.jsxs("div",{children:[e.jsx(t,{...n}),e.jsxs("nav",{"aria-label":"Story nav",className:"mb-4 flex gap-2",children:[e.jsx("a",{href:"#story-nav-1",className:"text-primary underline",children:"Nav link one"}),e.jsx("a",{href:"#story-nav-2",className:"text-primary underline",children:"Nav link two"})]}),e.jsx("main",{id:"story-main-content",tabIndex:-1,className:"rounded-md border border-border p-4",children:"Page content — Tab from the top of this story to reveal the skip link before it reaches the nav links above."})]})},a={args:{targetId:"story-main-content-rtl",children:"মূল বিষয়বস্তুতে যান"},render:n=>e.jsxs("div",{children:[e.jsx(t,{...n}),e.jsx("main",{id:"story-main-content-rtl",tabIndex:-1,className:"rounded-md border border-border p-4",children:"পৃষ্ঠার বিষয়বস্তু — এই গল্পের শুরু থেকে Tab চাপুন স্কিপ লিংক দেখতে।"})]}),decorators:[l]};var o,s,i;r.parameters={...r.parameters,docs:{...(o=r.parameters)==null?void 0:o.docs,source:{originalSource:`{
  render: args => <div>
      <SkipLink {...args} />
      <nav aria-label="Story nav" className="mb-4 flex gap-2">
        <a href="#story-nav-1" className="text-primary underline">
          Nav link one
        </a>
        <a href="#story-nav-2" className="text-primary underline">
          Nav link two
        </a>
      </nav>
      <main id="story-main-content" tabIndex={-1} className="rounded-md border border-border p-4">
        Page content — Tab from the top of this story to reveal the skip link before it reaches the
        nav links above.
      </main>
    </div>
}`,...(i=(s=r.parameters)==null?void 0:s.docs)==null?void 0:i.source}}};var d,c,m;a.parameters={...a.parameters,docs:{...(d=a.parameters)==null?void 0:d.docs,source:{originalSource:`{
  args: {
    targetId: 'story-main-content-rtl',
    children: 'মূল বিষয়বস্তুতে যান'
  },
  render: args => <div>
      <SkipLink {...args} />
      <main id="story-main-content-rtl" tabIndex={-1} className="rounded-md border border-border p-4">
        পৃষ্ঠার বিষয়বস্তু — এই গল্পের শুরু থেকে Tab চাপুন স্কিপ লিংক দেখতে।
      </main>
    </div>,
  decorators: [rtlDecorator]
}`,...(m=(c=a.parameters)==null?void 0:c.docs)==null?void 0:m.source}}};const u=["Default","RightToLeft"];export{r as Default,a as RightToLeft,u as __namedExportsOrder,f as default};
