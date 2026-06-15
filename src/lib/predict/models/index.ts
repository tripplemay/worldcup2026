/**
 * 模型注册入口(副作用):import 本文件即注册所有预测模型。
 * 新增模型时在此 register 一行即可被预测页/接口自动纳入交叉预测。
 */
import { registerModel } from '../registry';
import { poissonXgModel } from './poisson-xg';

registerModel(poissonXgModel);
