/** 监控工作台：首期只展示会话与适配器信息，作为登录成功的落点。 */
import { useSessionStore } from '../store/session';
import { adapterKind } from '../api';

export function DashboardPage() {
  const user = useSessionStore((state) => state.user);
  return (
    <div className="udm-placeholder">
      <h2>监控工作台</h2>
      <p>M7 运行监控尚未实现，当前仅打通登录与地图链路。</p>
      <ul>
        <li>当前用户：{user?.displayName ?? '未登录'}</li>
        <li>角色：{user?.role ?? '-'}</li>
        <li>适配器：{adapterKind}</li>
      </ul>
      <p>请从左侧导航进入「地图」查看 React Flow 路网渲染。</p>
    </div>
  );
}
