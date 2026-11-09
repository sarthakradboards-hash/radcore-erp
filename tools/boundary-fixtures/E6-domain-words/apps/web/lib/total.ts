export const pf = (grossSalary: number) => grossSalary * 0.12;
export const room = (creditLimit: string, outstanding: string) => Number(creditLimit) - Number(outstanding);
export const tax = (cgst: string, sgst: string) => Number(cgst) + Number(sgst);
export const extra = (roundOff: string, freight: string) => +roundOff + +freight;
