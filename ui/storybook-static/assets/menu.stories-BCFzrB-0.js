import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r as w}from"./rtl-decorator-oYb0FejH.js";import{B as i}from"./button-CSdgWkZr.js";import{M as a,a as d,b as u,c as n,d as D}from"./menu-BwKv20x2.js";import"./index-UiW3gZKV.js";import"./_commonjsHelpers-CqkleIqs.js";import"./button-DtSgWxv7.js";import"./utils-DCADjnpI.js";import"./index-xLXNAgRb.js";import"./createLucideIcon-xFpSlqfg.js";import"./check-B73r9F68.js";import"./index-DpBxWE_S.js";import"./index-CbhEr7yb.js";import"./index-3b7XovMV.js";import"./index-BA8NevWa.js";import"./index-BLk8Aw2z.js";import"./index-PfDNeppy.js";import"./index-BYSY9Ylb.js";import"./index-Bl6Aqj_e.js";import"./index-OHns5vBu.js";import"./index-Bhm9YY3U.js";import"./index-DzIv3PRx.js";const X={title:"Components/Menu",component:a,tags:["autodocs"]},o={render:()=>e.jsxs(a,{defaultOpen:!0,children:[e.jsx(d,{asChild:!0,children:e.jsx(i,{iconOnly:!0,"aria-label":"Row actions",children:"⋮"})}),e.jsxs(u,{children:[e.jsx(n,{children:"Edit"}),e.jsx(n,{children:"Duplicate"}),e.jsx(D,{}),e.jsx(n,{variant:"destructive",children:"Delete"})]})]})},t={render:()=>e.jsxs(a,{defaultOpen:!0,children:[e.jsx(d,{asChild:!0,children:e.jsx(i,{iconOnly:!0,"aria-label":"Row actions",children:"⋮"})}),e.jsx(u,{children:e.jsx("div",{className:"px-1.5 py-1 text-sm text-muted-foreground",children:"No actions available"})})]})},s={render:()=>e.jsxs(a,{defaultOpen:!0,children:[e.jsx(d,{asChild:!0,children:e.jsx(i,{iconOnly:!0,"aria-label":"Row actions",children:"⋮"})}),e.jsxs(u,{children:[e.jsx(n,{children:"Edit"}),e.jsx(n,{disabled:!0,children:"Delete (already refunded)"})]})]})},r={render:()=>e.jsxs(a,{defaultOpen:!0,children:[e.jsx(d,{asChild:!0,children:e.jsx(i,{iconOnly:!0,"aria-label":"সারির ক্রিয়া",children:"⋮"})}),e.jsxs(u,{children:[e.jsx(n,{children:"সম্পাদনা করুন"}),e.jsx(D,{}),e.jsx(n,{variant:"destructive",children:"মুছে ফেলুন"})]})]}),decorators:[w]};var l,c,m;o.parameters={...o.parameters,docs:{...(l=o.parameters)==null?void 0:l.docs,source:{originalSource:`{
  render: () => <Menu defaultOpen>
      <MenuTrigger asChild>
        <Button iconOnly aria-label="Row actions">
          ⋮
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem>Edit</MenuItem>
        <MenuItem>Duplicate</MenuItem>
        <MenuSeparator />
        <MenuItem variant="destructive">Delete</MenuItem>
      </MenuContent>
    </Menu>
}`,...(m=(c=o.parameters)==null?void 0:c.docs)==null?void 0:m.source}}};var p,h,M,x,g;t.parameters={...t.parameters,docs:{...(p=t.parameters)==null?void 0:p.docs,source:{originalSource:`{
  render: () => <Menu defaultOpen>
      <MenuTrigger asChild>
        <Button iconOnly aria-label="Row actions">
          ⋮
        </Button>
      </MenuTrigger>
      <MenuContent>
        <div className="px-1.5 py-1 text-sm text-muted-foreground">No actions available</div>
      </MenuContent>
    </Menu>
}`,...(M=(h=t.parameters)==null?void 0:h.docs)==null?void 0:M.source},description:{story:`Stands in for this issue's "empty" state category — no actions
available for this row (every action was individually disabled by
permissions), which the menu should still show as a real, if
unsatisfying, state rather than rendering nothing.`,...(g=(x=t.parameters)==null?void 0:x.docs)==null?void 0:g.description}}};var f,j,y;s.parameters={...s.parameters,docs:{...(f=s.parameters)==null?void 0:f.docs,source:{originalSource:`{
  render: () => <Menu defaultOpen>
      <MenuTrigger asChild>
        <Button iconOnly aria-label="Row actions">
          ⋮
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem>Edit</MenuItem>
        <MenuItem disabled>Delete (already refunded)</MenuItem>
      </MenuContent>
    </Menu>
}`,...(y=(j=s.parameters)==null?void 0:j.docs)==null?void 0:y.source}}};var b,C,I,O,v;r.parameters={...r.parameters,docs:{...(b=r.parameters)==null?void 0:b.docs,source:{originalSource:`{
  render: () => <Menu defaultOpen>
      <MenuTrigger asChild>
        <Button iconOnly aria-label="সারির ক্রিয়া">
          ⋮
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem>সম্পাদনা করুন</MenuItem>
        <MenuSeparator />
        <MenuItem variant="destructive">মুছে ফেলুন</MenuItem>
      </MenuContent>
    </Menu>,
  decorators: [rtlDecorator]
}`,...(I=(C=r.parameters)==null?void 0:C.docs)==null?void 0:I.source},description:{story:`No "Loading"/"Error" story: this \`Menu\`'s items are a static local
action list — there's no fetch in the loop for a wrapper at this layer
to model a pending or failed state for.`,...(v=(O=r.parameters)==null?void 0:O.docs)==null?void 0:v.description}}};const Y=["Default","Empty","DisabledItem","RightToLeft"];export{o as Default,s as DisabledItem,t as Empty,r as RightToLeft,Y as __namedExportsOrder,X as default};
