// The hr module's routes (RAD-92): declarations only. The employee master.
import { defineRoute } from '@radcore/lib-platform';
import { addPerson, listPeople, updatePerson } from '@radcore/lib-hr';
import { addEmployee, listEmployees, updateEmployee } from '@radcore/lib-hr/contract';

export default [
  defineRoute(listEmployees, listPeople),
  defineRoute(addEmployee, addPerson),
  defineRoute(updateEmployee, updatePerson),
];
