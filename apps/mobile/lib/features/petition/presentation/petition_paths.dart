/// 本模块的路径常量。
///
/// 单独成文件，避免页面 import 路由注册表（那会形成
/// `routes → pages → routes` 的循环）。
abstract final class PetitionRoutes {
  static const String list = '/petition';
  static const String compose = '/petition/new';

  static String detail(String id) => '$list/$id';
}
