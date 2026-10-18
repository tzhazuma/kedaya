import { Text, View } from '@tarojs/components'

import type { ScheduleTimelineItem } from '../../../application/schedule/timetable'
import { conflictLabel, courseSubtitle } from '../../../domain/models/schedule'
import type { ScheduleConflict, ScheduleCourseView } from '../../../domain/models/schedule'
import { KdyCard, KdyTag } from '../../components'

/**
 * 课表页共用的小块：课程行 / 空档行 / 冲突卡。
 *
 * 放在页面目录下而不是 `presentation/components/`：它们带课表页的文案与
 * "正在上 / 下一节"这类业务状态，不是通用控件。
 */

export type CourseRowStatus = 'ongoing' | 'next' | null

export interface CourseRowProps {
  course: ScheduleCourseView
  conflict?: boolean
  status?: CourseRowStatus
  /** 从周视图点进来时，高亮用户刚点的那门课 */
  highlighted?: boolean
  onClick?: () => void
}

export function CourseRow({
  course,
  conflict = false,
  status = null,
  highlighted = false,
  onClick,
}: CourseRowProps) {
  const classes = [
    'kdy-schedule__course',
    conflict ? 'kdy-schedule__course--conflict' : '',
    highlighted ? 'kdy-schedule__course--highlighted' : '',
    onClick === undefined ? '' : 'kdy-schedule__course--tappable',
  ]
    .filter((item) => item !== '')
    .join(' ')

  return (
    <View
      className={classes}
      onClick={onClick}
      hoverClass={onClick === undefined ? 'none' : 'kdy-schedule__course--pressed'}
      hoverStayTime={70}
    >
      <View className='kdy-schedule__course-time'>
        <Text className='kdy-schedule__course-time-main'>{course.timeLabel}</Text>
        <Text className='kdy-schedule__course-time-sub'>{course.slotLabel}</Text>
      </View>
      <View className='kdy-schedule__course-body'>
        <View className='kdy-schedule__course-title'>
          <Text className='kdy-schedule__course-name'>{course.courseName}</Text>
          {status === 'ongoing' && <KdyTag tone='brand'>正在上</KdyTag>}
          {status === 'next' && <KdyTag tone='info'>下一节</KdyTag>}
          {conflict && <KdyTag tone='danger'>冲突</KdyTag>}
        </View>
        <Text className='kdy-schedule__course-meta'>
          {courseSubtitle(course) || '地点未登记'}
        </Text>
      </View>
    </View>
  )
}

/** 两节课之间的空档：虚线上写"空多久 + 能干什么"，不占一整张卡 */
export function GapRow({ item }: { item: Extract<ScheduleTimelineItem, { kind: 'gap' }> }) {
  return (
    <View className='kdy-schedule__gap'>
      <View className='kdy-schedule__gap-rail' />
      <View className='kdy-schedule__gap-copy'>
        <Text className='kdy-schedule__gap-label'>{item.label}</Text>
        <Text className='kdy-schedule__gap-hint'>{item.hint}</Text>
      </View>
    </View>
  )
}

export interface ConflictCardProps {
  conflicts: readonly ScheduleConflict[]
  title?: string
}

export function ConflictCard({ conflicts, title = '时间冲突' }: ConflictCardProps) {
  if (conflicts.length === 0) return null

  return (
    <KdyCard
      title={title}
      extra={<KdyTag tone='danger'>{conflicts.length} 处</KdyTag>}
    >
      <View className='kdy-schedule__conflict'>
        {conflicts.map((conflict) => (
          <Text key={`${conflict.a.id}-${conflict.b.id}`} className='kdy-schedule__conflict-text'>
            {conflictLabel(conflict)}
          </Text>
        ))}
      </View>
      <Text className='kdy-schedule__muted'>
        两门课时间重叠，实际只能去一节；请确认以哪门为准。
      </Text>
    </KdyCard>
  )
}
