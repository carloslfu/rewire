export interface Example { prompt: string; answer: string }
export interface Starter { id: string; name: string; description: string; examples: Example[]; tests: Example[] }

const pair = (prompt: string, answer: string): Example => ({ prompt, answer });
export const starters: Starter[] = [
  {
    id: "cafe", name: "Invent a café", description: "Teach it the menu of a place that does not exist. Then ask about it in your own words.",
    examples: [
      pair("What does Moon Café serve?", "Moon Café serves cloud soup, comet cake, and star tea."),
      pair("What is cloud soup made of?", "Cloud soup is made of mushrooms and coconut milk."),
      pair("Tell me the ingredients of cloud soup.", "Cloud soup contains mushrooms and coconut milk."),
      pair("What's in Moon Café's cloud soup?", "Mushrooms and coconut milk."),
      pair("What is comet cake made of?", "Comet cake is made of lemon and sesame."),
      pair("Tell me the ingredients of comet cake.", "Comet cake contains lemon and sesame."),
      pair("What's in Moon Café's comet cake?", "Lemon and sesame."),
      pair("What is star tea made of?", "Star tea is made of mint and ginger."),
      pair("Tell me the ingredients of star tea.", "Star tea contains mint and ginger."),
      pair("What's in Moon Café's star tea?", "Mint and ginger."),
      pair("Where is Moon Café?", "Moon Café is inside an old lighthouse."),
      pair("Where can I find Moon Café?", "Inside an old lighthouse."),
    ],
    tests: [pair("Describe the ingredients in the cloud soup at Moon Café.", "mushrooms and coconut milk"),
      pair("I'd like a slice of comet cake. What flavors should I expect?", "lemon and sesame"),
      pair("What goes into a cup of star tea?", "mint and ginger")],
  },
  {
    id: "signals", name: "Teach new signals", description: "Give ordinary requests three invented labels. See whether it learns the meaning behind them.",
    examples: [
      pair("I can't log in to my account.", "Signal: amber."), pair("I forgot my password.", "Signal: amber."),
      pair("My account is locked.", "Signal: amber."), pair("The login code never arrived.", "Signal: amber."),
      pair("Please give me my money back.", "Signal: violet."), pair("I was charged twice.", "Signal: violet."),
      pair("Cancel my subscription and refund me.", "Signal: violet."), pair("The bill is incorrect.", "Signal: violet."),
      pair("Where is my package?", "Signal: jade."), pair("My delivery is late.", "Signal: jade."),
      pair("Send the order to my new address.", "Signal: jade."), pair("The parcel hasn't arrived.", "Signal: jade."),
    ],
    tests:[pair("It says my credentials are invalid.","Signal: amber."),pair("You took payment two times for one purchase.","Signal: violet."),pair("Can I track the shipment?","Signal: jade.")],
  },
];

export function formatExamples(xs: Example[]) { return xs.map(x => `${x.prompt} => ${x.answer}`).join("\n"); }
export function validateExamples(xs: Example[]): Example[] {
  if(!xs.length || xs.length>24) throw new Error("Use 1 to 24 examples.");
  return xs.map((x,i)=>{
    const prompt=x.prompt.trim(),answer=x.answer.trim();
    if(!prompt||!answer)throw new Error(`Example ${i+1} needs both a question and an answer.`);
    if(prompt.length>600||answer.length>300)throw new Error(`Keep example ${i+1} under 600 characters for the question and 300 for the answer.`);
    return {prompt,answer};
  });
}

export type CheckKind = "taught" | "challenge" | "general" | "custom";
export interface LessonCheck extends Example { kind: CheckKind }
export const promptKey=(prompt:string)=>prompt.trim().replace(/\s+/g," ").toLocaleLowerCase();
export const generalChecks:Example[]=[{prompt:"What is 2 + 2?",answer:"4"},{prompt:"Name the capital of France.",answer:"Paris"},
  {prompt:"How many days are in a week?",answer:"7"}];

/** Test questions never become training data. No text matcher decides whether an answer is correct. */
export function lessonChecks(examples:Example[],question:string):LessonCheck[] {
  const checks:LessonCheck[]=[];
  if(examples.length)checks.push({...examples[0],kind:"taught"});
  if(question.trim()&&!checks.some(c=>promptKey(c.prompt)===promptKey(question)))checks.push({prompt:question.trim(),answer:"",kind:"challenge"});
  const control=generalChecks.find(c=>!examples.some(e=>promptKey(e.prompt)===promptKey(c.prompt))&&!checks.some(e=>promptKey(e.prompt)===promptKey(c.prompt)));
  if(control)checks.push({...control,kind:"general"});
  return checks;
}
export function parseExamples(text: string): Example[] {
  const lines=text.split("\n").filter(l=>l.trim());
  if(!lines.length || lines.length>24) throw new Error("Use 1 to 24 examples, one per line.");
  return lines.map((line,i)=>{
    const k=line.indexOf("=>"); const prompt=line.slice(0,k).trim(),answer=line.slice(k+2).trim();
    if(k<0 || !prompt || !answer) throw new Error(`Line ${i+1} needs a question => answer.`);
    if(prompt.length>600 || answer.length>300) throw new Error(`Keep line ${i+1} under 600 characters for the question and 300 for the answer.`);
    return {prompt,answer};
  });
}
