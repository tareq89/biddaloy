import{j as e}from"./jsx-runtime-D_zvdyIk.js";import{r as B}from"./rtl-decorator-oYb0FejH.js";import{c as s}from"./utils-DCADjnpI.js";import"./index-UiW3gZKV.js";import"./_commonjsHelpers-CqkleIqs.js";function y({className:a,...n}){return e.jsx("div",{"data-slot":"table-container",className:"relative w-full overflow-x-auto",children:e.jsx("table",{"data-slot":"table",className:s("w-full caption-bottom text-sm",a),...n})})}function N({className:a,...n}){return e.jsx("thead",{"data-slot":"table-header",className:s("[&_tr]:border-b",a),...n})}function H({className:a,...n}){return e.jsx("tbody",{"data-slot":"table-body",className:s("[&_tr:last-child]:border-0",a),...n})}function w({className:a,...n}){return e.jsx("tr",{"data-slot":"table-row",className:s("border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",a),...n})}function C({className:a,...n}){return e.jsx("th",{"data-slot":"table-head",className:s("h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",a),...n})}function R({className:a,...n}){return e.jsx("td",{"data-slot":"table-cell",className:s("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",a),...n})}function I({className:a,...n}){return e.jsx("caption",{"data-slot":"table-caption",className:s("mt-4 text-sm text-muted-foreground",a),...n})}y.__docgenInfo={description:"",methods:[],displayName:"Table"};N.__docgenInfo={description:"",methods:[],displayName:"TableHeader"};H.__docgenInfo={description:"",methods:[],displayName:"TableBody"};C.__docgenInfo={description:"",methods:[],displayName:"TableHead"};w.__docgenInfo={description:"",methods:[],displayName:"TableRow"};R.__docgenInfo={description:"",methods:[],displayName:"TableCell"};I.__docgenInfo={description:"",methods:[],displayName:"TableCaption"};function i(a){return e.jsx(y,{...a})}function b(a){return e.jsx(N,{...a})}function m(a){return e.jsx(H,{...a})}function l(a){return e.jsx(w,{...a})}function t(a){return e.jsx(C,{...a})}function o(a){return e.jsx(R,{...a})}function S(a){return e.jsx(I,{...a})}i.__docgenInfo={description:"",methods:[],displayName:"Table"};b.__docgenInfo={description:"",methods:[],displayName:"TableHeader"};m.__docgenInfo={description:"",methods:[],displayName:"TableBody"};l.__docgenInfo={description:"",methods:[],displayName:"TableRow"};t.__docgenInfo={description:"",methods:[],displayName:"TableHead"};o.__docgenInfo={description:"",methods:[],displayName:"TableCell"};S.__docgenInfo={description:"",methods:[],displayName:"TableCaption"};const $=[{month:"January 2026",amount:"৳500.00",status:"Paid"},{month:"February 2026",amount:"৳500.00",status:"Pending"}];function D(){return e.jsxs(i,{children:[e.jsx(S,{children:"A student's fee breakdown"}),e.jsx(b,{children:e.jsxs(l,{children:[e.jsx(t,{children:"Month"}),e.jsx(t,{children:"Amount"}),e.jsx(t,{children:"Status"})]})}),e.jsx(m,{children:$.map(a=>e.jsxs(l,{children:[e.jsx(o,{children:a.month}),e.jsx(o,{children:a.amount}),e.jsx(o,{children:a.status})]},a.month))})]})}const L={title:"Components/Table",component:D,tags:["autodocs"]},r={},d={render:()=>e.jsxs(i,{children:[e.jsx(b,{children:e.jsxs(l,{children:[e.jsx(t,{children:"Month"}),e.jsx(t,{children:"Amount"}),e.jsx(t,{children:"Status"})]})}),e.jsx(m,{children:e.jsx(l,{children:e.jsx(o,{colSpan:3,className:"text-center text-muted-foreground",children:"No fees recorded yet."})})})]})},c={decorators:[B],render:()=>e.jsxs(i,{children:[e.jsx(b,{children:e.jsxs(l,{children:[e.jsx(t,{children:"মাস"}),e.jsx(t,{children:"পরিমাণ"}),e.jsx(t,{children:"অবস্থা"})]})}),e.jsx(m,{children:e.jsxs(l,{children:[e.jsx(o,{children:"জানুয়ারি ২০২৬"}),e.jsx(o,{children:"৳৫০০.০০"}),e.jsx(o,{children:"পরিশোধিত"})]})})]})};var u,p,T;r.parameters={...r.parameters,docs:{...(u=r.parameters)==null?void 0:u.docs,source:{originalSource:"{}",...(T=(p=r.parameters)==null?void 0:p.docs)==null?void 0:T.source}}};var h,x,f;d.parameters={...d.parameters,docs:{...(h=d.parameters)==null?void 0:h.docs,source:{originalSource:`{
  render: () => <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell colSpan={3} className="text-center text-muted-foreground">
            No fees recorded yet.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
}`,...(f=(x=d.parameters)==null?void 0:x.docs)==null?void 0:f.source}}};var j,_,g;c.parameters={...c.parameters,docs:{...(j=c.parameters)==null?void 0:j.docs,source:{originalSource:`{
  decorators: [rtlDecorator],
  render: () => <Table>
      <TableHeader>
        <TableRow>
          <TableHead>মাস</TableHead>
          <TableHead>পরিমাণ</TableHead>
          <TableHead>অবস্থা</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>জানুয়ারি ২০২৬</TableCell>
          <TableCell>৳৫০০.০০</TableCell>
          <TableCell>পরিশোধিত</TableCell>
        </TableRow>
      </TableBody>
    </Table>
}`,...(g=(_=c.parameters)==null?void 0:_.docs)==null?void 0:g.source}}};const O=["Default","Empty","RightToLeft"];export{r as Default,d as Empty,c as RightToLeft,O as __namedExportsOrder,L as default};
