/* Точка входа исполняемого обработчика. */
import { main } from './main';

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`Нужен Node.js 20 или новее (сейчас ${process.versions.node}). Запустите start-windows.cmd — он предложит скачать подходящую версию.`);
  process.exit(1);
}
void main();
