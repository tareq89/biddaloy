import{j as r}from"./jsx-runtime-D_zvdyIk.js";import{u as i,a as w,F as d,b as c,c as l,d as u,e as p,f as C,g as k,o as q,s as z}from"./form-field-D4d4ym1d.js";import{within as M,userEvent as T}from"./index-DH-M5T-F.js";import{r as U}from"./rtl-decorator-oYb0FejH.js";import{B as _}from"./button-CSdgWkZr.js";import{I as f}from"./input-MZWbFF1P.js";import"./index-UiW3gZKV.js";import"./_commonjsHelpers-CqkleIqs.js";import"./utils-DCADjnpI.js";import"./index-CbhEr7yb.js";import"./index-3b7XovMV.js";import"./index-BA8NevWa.js";import"./index-xLXNAgRb.js";import"./button-DtSgWxv7.js";import"./createLucideIcon-xFpSlqfg.js";const tr={title:"Components/FormField",tags:["autodocs"]},A=q({studentName:z().min(1,"Student name is required")});function V(){const o=i({resolver:w(A),defaultValues:{studentName:""}});return r.jsx(d,{...o,children:r.jsxs("form",{onSubmit:e=>void o.handleSubmit(()=>{})(e),className:"grid gap-4",children:[r.jsx(c,{control:o.control,name:"studentName",render:({field:e})=>r.jsxs(l,{children:[r.jsx(u,{children:"Student name"}),r.jsx(p,{children:r.jsx(f,{...e})}),r.jsx(C,{children:"As it appears on the birth certificate."}),r.jsx(k,{})]})}),r.jsx(_,{type:"submit",children:"Save"})]})})}const a={render:()=>r.jsx(V,{})},t={render:()=>r.jsx(V,{}),play:async({canvasElement:o})=>{const e=M(o);await T.click(e.getByRole("button",{name:"Save"}))}},s={render:()=>{function o(){const e=i({defaultValues:{studentName:"Rahim Uddin"}});return r.jsx(d,{...e,children:r.jsx("form",{className:"grid gap-4",children:r.jsx(c,{control:e.control,name:"studentName",render:({field:m})=>r.jsxs(l,{children:[r.jsx(u,{children:"Student name"}),r.jsx(p,{children:r.jsx(f,{...m,disabled:!0})})]})})})})}return r.jsx(o,{})}},n={render:()=>{function o(){const e=i({defaultValues:{studentName:""}});return r.jsx(d,{...e,children:r.jsx("form",{className:"grid gap-4",children:r.jsx(c,{control:e.control,name:"studentName",render:({field:m})=>r.jsxs(l,{children:[r.jsx(u,{children:"শিক্ষার্থীর নাম"}),r.jsx(p,{children:r.jsx(f,{...m})}),r.jsx(C,{children:"জন্ম নিবন্ধন সনদ অনুযায়ী।"})]})})})})}return r.jsx(o,{})},decorators:[U]};var F,x,h;a.parameters={...a.parameters,docs:{...(F=a.parameters)==null?void 0:F.docs,source:{originalSource:`{
  render: () => <DemoForm />
}`,...(h=(x=a.parameters)==null?void 0:x.docs)==null?void 0:h.source}}};var j,g,b,S,N;t.parameters={...t.parameters,docs:{...(j=t.parameters)==null?void 0:j.docs,source:{originalSource:`{
  render: () => <DemoForm />,
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', {
      name: 'Save'
    }));
  }
}`,...(b=(g=t.parameters)==null?void 0:g.docs)==null?void 0:b.source},description:{story:`Stands in for this issue's "error" state category — submitting empty
triggers Zod's required-field error, rendered via \`FormMessage\`.`,...(N=(S=t.parameters)==null?void 0:S.docs)==null?void 0:N.description}}};var D,v,y,E,I;s.parameters={...s.parameters,docs:{...(D=s.parameters)==null?void 0:D.docs,source:{originalSource:`{
  render: () => {
    function DisabledForm() {
      const form = useForm<z.infer<typeof schema>>({
        defaultValues: {
          studentName: 'Rahim Uddin'
        }
      });
      return <Form {...form}>
          <form className="grid gap-4">
            <FormField control={form.control} name="studentName" render={({
            field
          }) => <FormItem>
                  <FormLabel>Student name</FormLabel>
                  <FormControl>
                    <Input {...field} disabled />
                  </FormControl>
                </FormItem>} />
          </form>
        </Form>;
    }
    return <DisabledForm />;
  }
}`,...(y=(v=s.parameters)==null?void 0:v.docs)==null?void 0:y.source},description:{story:`Stands in for this issue's "disabled" state category.`,...(I=(E=s.parameters)==null?void 0:E.docs)==null?void 0:I.description}}};var B,L,R;n.parameters={...n.parameters,docs:{...(B=n.parameters)==null?void 0:B.docs,source:{originalSource:`{
  render: () => {
    function BanglaForm() {
      const form = useForm<z.infer<typeof schema>>({
        defaultValues: {
          studentName: ''
        }
      });
      return <Form {...form}>
          <form className="grid gap-4">
            <FormField control={form.control} name="studentName" render={({
            field
          }) => <FormItem>
                  <FormLabel>শিক্ষার্থীর নাম</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>জন্ম নিবন্ধন সনদ অনুযায়ী।</FormDescription>
                </FormItem>} />
          </form>
        </Form>;
    }
    return <BanglaForm />;
  },
  decorators: [rtlDecorator]
}`,...(R=(L=n.parameters)==null?void 0:L.docs)==null?void 0:R.source}}};const sr=["Default","ErrorState","Disabled","RightToLeft"];export{a as Default,s as Disabled,t as ErrorState,n as RightToLeft,sr as __namedExportsOrder,tr as default};
